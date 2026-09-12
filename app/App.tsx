import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  FlatList,
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
import { sendToReceiver, toForwarded } from "./lanForwarding";

/**
 * M2, first slice (see notification-sync-prd.md §10).
 *
 * M0 proved capture. M1 proved the wire shape by forwarding it in the clear and
 * confirmed §7's `ForwardedNotification` needs no extra fields. M2 encrypts it:
 * payloads now leave as AES-256-GCM ciphertext per §12 Q2.
 *
 * Still absent: **pairing**. Both ends share a fixed development key committed
 * to a public repository — see the warning in `crypto.ts`. Until FR-1 and FR-2
 * land, this is authenticated encryption with a key everyone has, which is a
 * transport test rather than a security property. Also still absent: filtering,
 * queueing, retry, discovery, and a foreground service.
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
  | { state: "sent" }
  | { state: "failed"; error: string };

/**
 * Identifies the sender in the payload (§7's `deviceLabel`).
 *
 * Hardcoded: at M2 this comes from the pairing flow, and inventing a settings
 * screen for it now would be building M6 inside M1.
 */
const DEVICE_LABEL = "Samsung A52";

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
  const [testResult, setTestResult] = useState<string | null>(null);
  const nextSeq = useRef(1);

  // The capture subscription is set up once, so reading `host` and `forwarding`
  // directly inside it would capture their first values forever. Mirroring them
  // into refs keeps the current value available without tearing down and
  // rebuilding the native listener subscription on every keystroke.
  const hostRef = useRef(host);
  const forwardingRef = useRef(forwarding);
  hostRef.current = host;
  forwardingRef.current = forwarding;

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

      // Sequence numbers are consumed only by notifications actually sent, so a
      // gap at the receiver means a lost delivery (FR-26) rather than one the
      // user chose not to forward. Taken here, before the await, so concurrent
      // captures cannot interleave and produce out-of-order numbering.
      const seq = nextSeq.current++;
      const payload = toForwarded(notification, seq, DEVICE_LABEL);

      // Deliberately not awaited: the listener callback is a native event
      // handler, and blocking it would apply backpressure to capture itself.
      // Dropping a send on failure is correct for M1 — queueing and retry are
      // M3, and inventing them here would hide exactly the losses M1 should
      // surface.
      void sendToReceiver(hostRef.current, payload).then((result) => {
        markForwarded(
          captureId,
          result.ok ? { state: "sent" } : { state: "failed", error: result.error },
        );
      });
    });
    return () => sub.remove();
  }, [markForwarded]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="auto" />

      <View style={styles.header}>
        <Text style={styles.title}>NotifSync</Text>
        <Text style={styles.subtitle}>M2 — AES-256-GCM, fixed dev key</Text>
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
        <TextInput
          style={styles.input}
          value={host}
          onChangeText={setHost}
          placeholder="192.168.1.11:8787"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          inputMode="url"
        />
        <Pressable
          style={styles.buttonSecondary}
          onPress={() => {
            // A connectivity check that does not require waiting for a real
            // notification. Wrong IP, wrong port, phone on mobile data and
            // laptop firewall are all the same symptom — nothing arrives — and
            // this separates "the network is wrong" from "capture is wrong".
            const seq = nextSeq.current++;
            void sendToReceiver(host, {
              id: `test-${seq}`,
              seq,
              sourceApp: "NotifSync (test)",
              title: "Test payload",
              body: "If this prints on the laptop, the LAN path works.",
              timestamp: Date.now(),
              deviceLabel: DEVICE_LABEL,
            }).then((result) => {
              setTestResult(result.ok ? "sent ✓" : `failed — ${result.error}`);
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

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.captureId)}
        contentContainerStyle={items.length === 0 && styles.emptyContainer}
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
                {item.forward.state === "sent" && "forwarded ✓"}
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
