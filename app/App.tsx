import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import NotificationListener, {
  CapturedNotification,
} from "./modules/notification-listener";
import { toForwarded } from "./lanForwarding";
import { forwardNotification } from "./forwarding";
import type { Transport } from "./forwarding";
import { deliverySummary } from "./deliveryStore";
import {
  currentPairing,
  initPairing,
  myPairingPayload,
  pairWith,
  unpair,
} from "./pairingState";
import { relayUrl, setRelayUrl } from "./relayClient";
import { registerForPush, startPushLifecycle } from "./push";
import type { PushState } from "./push";

/**
 * M3 Android relay sender/receiver. LAN remains an explicit development mode.
 * Sender capture requires the JS runtime; foreground-service hardening is M5.
 * Filtering and QR scanning remain deferred by the approved M3 plan.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <CaptureScreen />
    </SafeAreaProvider>
  );
}

/**
 * One row of the capture log — a notification *as captured*, not a notification.
 *
 * The distinction matters. `StatusBarNotification.key` identifies the
 * notification, and Android keeps it stable while an app updates that
 * notification in place: WhatsApp re-posts a chat under one unchanging key as
 * messages arrive, and SystemUI re-posts `charging_state` about once a minute.
 * Keying rows on it therefore collides, which React reports as duplicate keys.
 *
 * `captureId` is assigned per delivery instead, so each capture is its own row.
 * Collapsing re-posts here would be the wrong fix at M0 — the spike exists to
 * measure capture volume, and duplicate rows are the evidence feeding FR-8's
 * dedupe design and FR-9's rate limit. Suppression belongs at M4, downstream of
 * a measurement that has to stay visible until then.
 */
type CaptureRow = CapturedNotification & {
  captureId: number;
  /**
   * What happened when this capture was forwarded.
   *
   * Shown per row rather than as one global "last send" line because the
   * interesting failure at M1 is partial: captures continuing while sends
   * silently stop, which a single status line hides and a per-row one makes
   * obvious at a glance.
   */
  forward: ForwardState;
};

type ForwardState =
  | { state: "off" }
  | { state: "pending" }
  | { state: "sent"; detail: string }
  | { state: "failed"; error: string };

/**
 * Identifies the sender in the payload (§7's `deviceLabel`).
 *
 * Read from the device rather than hardcoded, which it was until a second phone
 * appeared and reported itself as "Samsung A52". That is not cosmetic: FR-26
 * tracks sequence numbers **per device label**, so two senders sharing a label
 * merge into one sequence stream and manufacture gaps out of nothing — the exact
 * measurement M5's soak test depends on.
 *
 * A user-chosen label belongs to pairing (FR-4 shows device labels) and is not
 * this file's job; the model name is a correct default until then.
 */
const DEVICE_LABEL = (() => {
  const constants = Platform.constants as { Model?: string } | undefined;
  const model = constants?.Model?.trim();
  return model ? model : `${Platform.OS} device`;
})();

function CaptureScreen() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<CaptureRow[]>([]);
  const nextCaptureId = useRef(0);

  /**
   * Defaults to the USB reverse tunnel, not a LAN address.
   *
   * `adb reverse tcp:8787 tcp:8787` makes the laptop's receiver port appear as
   * 127.0.0.1:8787 *on the phone*, so the loop closes over the cable that is
   * already attached for development. That removes the three things that
   * actually break a first LAN run — the phone being on mobile data, the host
   * IP changing with DHCP, and Windows Firewall dropping inbound connections
   * silently — none of which teach anything about the payload shape M1 exists
   * to test.
   *
   * Replace with `<laptop-ip>:8787` for a genuine over-the-air run. That is
   * worth doing before M1 is called done, because it is the first time the
   * phone's radio, and not a cable, carries a notification.
   */
  const [host, setHost] = useState("127.0.0.1:8787");
  const [forwarding, setForwarding] = useState(false);
  const [transport, setTransport] = useState<Transport>("relay");
  const [testResult, setTestResult] = useState<string | null>(null);

  // The capture subscription is set up once, so reading `host` and `forwarding`
  // directly inside it would capture their first values forever. Mirroring them
  // into refs keeps the current value available without tearing down and
  // rebuilding the native listener subscription on every keystroke.
  const hostRef = useRef(host);
  const forwardingRef = useRef(forwarding);
  const transportRef = useRef(transport);
  hostRef.current = host;
  forwardingRef.current = forwarding;
  transportRef.current = transport;

  const refreshPermission = useCallback(() => {
    const granted = NotificationListener.isEnabled();
    setEnabled(granted);
    // An app update breaks the binding but leaves the grant in place, so
    // "granted" is not the same as "connected". Asking every time we foreground
    // is cheap and is the only way back — the disconnect callback never fires,
    // because the service is never constructed in the new process.
    if (granted) NotificationListener.requestRebind();
  }, []);

  // The notification-access grant happens in a system settings screen, so the
  // only reliable moment to re-check it is when we come back to the foreground.
  useEffect(() => {
    refreshPermission();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  const markForwarded = useCallback((captureId: number, forward: ForwardState) => {
    setItems((prev) =>
      prev.map((row) => (row.captureId === captureId ? { ...row, forward } : row)),
    );
  }, []);

  useEffect(() => {
    const sub = NotificationListener.addNotificationListener((notification) => {
      // Incremented here rather than inside the updater: React may invoke an
      // updater more than once for the same delivery, which would burn ids and,
      // under a future concurrent render, hand two rows the same one.
      const captureId = nextCaptureId.current++;
      const shouldForward = forwardingRef.current;

      setItems((prev) =>
        [
          {
            ...notification,
            captureId,
            forward: shouldForward
              ? ({ state: "pending" } as ForwardState)
              : ({ state: "off" } as ForwardState),
          },
          ...prev,
        ].slice(0, 200),
      );

      if (!shouldForward) return;

      // Encryption and durable numbering/queueing run outside the native callback.
      void forwardNotification(seq => toForwarded(notification, seq, DEVICE_LABEL), transportRef.current, hostRef.current).then((result) => {
        markForwarded(
          captureId,
          result.ok ? { state: "sent", detail: result.status } : { state: "failed", error: result.error },
        );
      });
    });
    return () => sub.remove();
  }, [markForwarded]);

  /**
   * Everything above the capture list, rendered as the list's header.
   *
   * These cards used to be siblings of the `FlatList`, which meant they occupied
   * fixed height outside any scroll container: once the pairing card was added
   * the content became taller than the screen and nothing could be reached.
   * `ListHeaderComponent` puts them inside the list's own scroll view, so the
   * whole page scrolls as one and the list keeps its virtualisation.
   */
  const header = (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>NotifSync</Text>
        <Text style={styles.subtitle}>M3 — encrypted relay delivery</Text>
      </View>

      <View style={styles.permissionCard}>
        <Text style={styles.permissionLabel}>Notification access</Text>
        <Text
          style={[
            styles.permissionValue,
            enabled ? styles.granted : styles.notGranted,
          ]}
        >
          {enabled === null
            ? "checking…"
            : enabled
              ? "granted"
              : "not granted"}
        </Text>
        <Pressable
          style={styles.button}
          onPress={() => NotificationListener.openSettings()}
        >
          <Text style={styles.buttonText}>
            {enabled ? "Open settings" : "Grant notification access"}
          </Text>
        </Pressable>
      </View>

      <PairingCard />
      <RelayCard />

      <View style={styles.permissionCard}>
        <View style={styles.forwardRow}>
          <View style={styles.forwardLabels}>
            <Text style={styles.permissionLabel}>Forward to receiver</Text>
            <Text style={styles.permissionValue}>
              {forwarding ? "on" : "off"}
            </Text>
          </View>
          <Switch value={forwarding} onValueChange={setForwarding} />
        </View>
        <View style={styles.forwardRow}>
          <Pressable style={styles.buttonSecondary} onPress={() => setTransport("relay")}>
            <Text style={styles.buttonSecondaryText}>{transport === "relay" ? "✓ Relay" : "Use relay"}</Text>
          </Pressable>
          <Pressable style={styles.buttonSecondary} onPress={() => setTransport("lan")}>
            <Text style={styles.buttonSecondaryText}>{transport === "lan" ? "✓ LAN test" : "Use LAN test"}</Text>
          </Pressable>
        </View>
        <Text style={styles.keyNotice}>Keep the sender app running during M3 tests. Capture while its JS runtime is absent is not implemented.</Text>
        {transport === "lan" && <TextInput
          style={styles.input}
          value={host}
          onChangeText={setHost}
          placeholder="192.168.1.11:8787"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          inputMode="url"
        />}
        <Pressable
          style={styles.buttonSecondary}
          onPress={() => {
            // A connectivity check that does not require waiting for a real
            // notification. Wrong IP, wrong port, phone on mobile data and
            // laptop firewall are all the same symptom — nothing arrives — and
            // this separates "the network is wrong" from "capture is wrong".
            void forwardNotification(seq => ({
              id: `test-${seq}`,
              seq,
              sourceApp: "NotifSync (test)",
              title: "Test payload",
              body: "M3 QA: verify this notification on the paired receiver.",
              timestamp: Date.now(),
              deviceLabel: DEVICE_LABEL,
            }), transport, host).then((result) => {
              setTestResult(result.ok ? result.status : `failed — ${result.error}`);
            });
            setTestResult("sending…");
          }}
        >
          <Text style={styles.buttonSecondaryText}>Send test payload</Text>
        </Pressable>
        {!!testResult && <Text style={styles.testResult}>{testResult}</Text>}
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Captured ({items.length})</Text>
        {items.length > 0 && (
          <Pressable onPress={() => setItems([])} hitSlop={8}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        )}
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="auto" />

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.captureId)}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.empty}>
            {enabled
              ? "Waiting for a notification to arrive…"
              : "Grant notification access, then post a notification."}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.appLabel} numberOfLines={1}>
                {item.appLabel ?? item.packageName}
              </Text>
              <Text style={styles.time}>
                {new Date(item.postTime).toLocaleTimeString()}
              </Text>
            </View>
            {!!item.title && <Text style={styles.notifTitle}>{item.title}</Text>}
            {!!item.body && (
              <Text style={styles.notifBody} numberOfLines={3}>
                {item.body}
              </Text>
            )}
            <Text style={styles.meta}>
              {item.packageName}
              {item.ongoing ? " · ongoing" : ""}
              {item.silent ? " · silent" : ""}
            </Text>
            {item.forward.state !== "off" && (
              <Text
                style={[
                  styles.forwardState,
                  item.forward.state === "sent" && styles.granted,
                  item.forward.state === "failed" && styles.notGranted,
                ]}
              >
                {item.forward.state === "pending" && "forwarding…"}
                {item.forward.state === "sent" && item.forward.detail}
                {item.forward.state === "failed" &&
                  `not forwarded — ${item.forward.error}`}
              </Text>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

/**
 * FR-1 / FR-2 pairing, via manual code entry.
 *
 * FR-2 lists manual entry as the fallback for when the camera is unusable, and
 * it is built first here on purpose: it exercises the identical X25519 exchange
 * while needing no `expo-camera`, no QR renderer, and no native rebuild, so the
 * key agreement can be proven before any scanning UI exists. A QR screen is a
 * presentation layer over this exact code path.
 *
 * The fingerprint is the point of the display. Both devices must show the same
 * four bytes *crosswise* — this device's `send` equals the other's `recv`. If
 * the derivation ever disagreed across devices, every downstream symptom would
 * be an AEAD authentication failure at the far end, which points at the cipher
 * rather than at pairing. Two numbers on two screens localises it immediately.
 */
function PairingCard() {
  const [peerCode, setPeerCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pairing, setPairing] = useState(() => currentPairing());
  const [myCode, setMyCode] = useState<string | null>(null);

  // Identity and any stored pairing come out of Keystore/Keychain, so this is
  // async and nothing else here can run until it resolves. Failing loudly is
  // deliberate: a silent failure would generate a fresh identity and present as
  // the pairing having spontaneously broken.
  useEffect(() => {
    let cancelled = false;
    initPairing()
      .then(() => {
        if (cancelled) return;
        const payload = myPairingPayload(Platform.OS === "android" ? "android" : "ios");
        setMyCode(JSON.stringify(payload));
        setPairing(currentPairing());
      })
      .catch((e: unknown) => {
        if (!cancelled) setStatus("secure storage failed; identity was not replaced");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!myCode) {
    return (
      <View style={styles.permissionCard}>
        <Text style={styles.permissionLabel}>Pairing</Text>
        <Text style={styles.permissionValue}>
          {status ? "unavailable" : "loading keys…"}
        </Text>
        {!!status && <Text style={styles.testResult}>{status}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.permissionCard}>
      <Text style={styles.permissionLabel}>Pairing</Text>
      <Text
        style={[
          styles.permissionValue,
          pairing.paired ? styles.granted : styles.notGranted,
        ]}
      >
        {pairing.paired ? `paired with ${pairing.peerDeviceId}` : "not paired"}
      </Text>

      {/* Compare these fingerprints crosswise on the two phones. */}
      <Text style={styles.keyNotice}>
        {pairing.paired
          ? `key: derived · ${pairing.fingerprint}`
          : "Pair a device before forwarding. Reinstall or data clear requires re-pairing."}
      </Text>

      <Text style={styles.codeLabel}>This device's code</Text>
      <Text style={styles.code} selectable numberOfLines={3}>
        {myCode}
      </Text>

      <TextInput
        style={styles.input}
        value={peerCode}
        onChangeText={setPeerCode}
        placeholder="Paste the other device's code"
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      <Pressable
        style={styles.buttonSecondary}
        onPress={() => {
          setStatus("pairing…");
          void pairWith(peerCode).then((result) => {
            setStatus(result.ok ? "paired ✓" : `failed — ${result.error}`);
            setPairing(currentPairing());
          }).catch(() => setStatus("could not persist pairing"));
        }}
      >
        <Text style={styles.buttonSecondaryText}>Pair</Text>
      </Pressable>

      {pairing.paired && (
        <Pressable
          style={styles.buttonSecondary}
          onPress={() => {
            void unpair().then(() => {
              setPairing(currentPairing());
              setStatus("unpaired");
            }).catch(() => setStatus("could not remove stored pairing"));
          }}
        >
          <Text style={styles.buttonSecondaryText}>Unpair</Text>
        </Pressable>
      )}

      {!!status && <Text style={styles.testResult}>{status}</Text>}
    </View>
  );
}

/**
 * Relay registration and push state (M3.2).
 *
 * Everything here is displayed rather than merely attempted, because each of
 * these can fail in a way that leaves the app looking healthy while it is
 * unreachable: permission denied means the receiver pairs and displays nothing
 * (FR-31), a missing FCM token means pushes go nowhere, and a failed relay
 * registration means the relay cannot address this device at all. All three
 * present as "notifications just stopped", which is the symptom FR-33's
 * diagnostics screen exists to explain.
 */
function RelayCard() {
  const [url, setUrl] = useState<string | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("Loading delivery state…");
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => startPushLifecycle(setPush), []);
  useEffect(() => {
    let cancelled = false;
    const update = () => void deliverySummary().then(value => {
      if (!cancelled) setSummary(value);
    }).catch(() => { if (!cancelled) setSummary("Delivery storage unavailable"); });
    update();
    const timer = setInterval(update, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void relayUrl().then((value) => {
      if (!cancelled) setUrl(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const register = useCallback(() => {
    setBusy(true);
    void registerForPush()
      .then((state) => setPush(state))
      .catch(() => setSettingsError("registration failed"))
      .finally(() => setBusy(false));
  }, []);

  return (
    <View style={styles.permissionCard}>
      <Text style={styles.permissionLabel}>Relay</Text>
      <Text
        style={[
          styles.permissionValue,
          push?.token && !push.error ? styles.granted : styles.notGranted,
        ]}
      >
        {push === null
          ? "not registered"
          : push.error
            ? "error"
            : push.token
              ? "registered"
              : "no token"}
      </Text>

      <Text style={styles.keyNotice}>
        {push === null
          ? "push permission unknown"
          : `notifications ${push.permissionGranted ? "allowed" : "BLOCKED (FR-31)"}`}
      </Text>

      <TextInput
        style={styles.input}
        value={url ?? ""}
        onChangeText={setUrl}
        placeholder="https://your-relay.workers.dev"
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="url"
      />

      <Pressable style={styles.buttonSecondary} onPress={() => {
        if (url) void setRelayUrl(url).then(() => { setSettingsError(null); register(); })
          .catch(() => setSettingsError("Enter an HTTPS relay origin; settings were not saved."));
      }}>
        <Text style={styles.buttonSecondaryText}>Save relay URL</Text>
      </Pressable>

      <Pressable style={styles.buttonSecondary} onPress={register} disabled={busy}>
        <Text style={styles.buttonSecondaryText}>
          {busy ? "registering…" : "Register with relay"}
        </Text>
      </Pressable>

      <Text style={styles.keyNotice}>{push?.token ? "FCM token acquired (hidden)" : "FCM token unavailable"} · receiver {push?.receiverReady ? "ready" : "unavailable"}</Text>
      <Text style={styles.testResult}>{summary}</Text>
      {!!settingsError && <Text style={[styles.testResult, styles.notGranted]}>{settingsError}</Text>}
      {!!push?.error && <Text style={[styles.testResult, styles.notGranted]}>{push.error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  header: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 13, color: "#666", marginTop: 2 },
  permissionCard: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#f4f5f7",
  },
  permissionLabel: { fontSize: 13, color: "#666" },
  permissionValue: { fontSize: 17, fontWeight: "600", marginTop: 2 },
  granted: { color: "#1a7f37" },
  notGranted: { color: "#b3261e" },
  button: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#1f2937",
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "600" },
  forwardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  forwardLabels: { flex: 1 },
  input: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#c9ccd1",
    fontSize: 15,
  },
  buttonSecondary: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    alignItems: "center",
  },
  buttonSecondaryText: { color: "#1f2937", fontWeight: "600" },
  testResult: { marginTop: 8, fontSize: 13, color: "#444" },
  keyNotice: { marginTop: 4, fontSize: 12, color: "#666", fontWeight: "600" },
  codeLabel: { marginTop: 12, fontSize: 12, color: "#666" },
  code: { fontSize: 10, color: "#333", marginTop: 2 },
  forwardState: { marginTop: 4, fontSize: 11, fontWeight: "600" },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  listTitle: { fontSize: 15, fontWeight: "600" },
  clear: { fontSize: 14, color: "#b3261e" },
  emptyContainer: { flexGrow: 1, justifyContent: "center" },
  empty: { textAlign: "center", color: "#888", paddingHorizontal: 40 },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e2e2e2",
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between" },
  appLabel: { fontWeight: "600", flex: 1, marginRight: 8 },
  time: { color: "#888", fontSize: 12 },
  notifTitle: { marginTop: 4, fontSize: 15 },
  notifBody: { marginTop: 2, color: "#444", fontSize: 14 },
  meta: { marginTop: 6, fontSize: 11, color: "#999" },
});
