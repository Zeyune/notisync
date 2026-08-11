import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import NotificationListener, {
  CapturedNotification,
} from "./modules/notification-listener";

/**
 * M0 spike (see notification-sync-prd.md §10).
 *
 * Scope is deliberately narrow: prove that a Kotlin NotificationListenerService
 * can capture notifications and hand them to JS. No network, no encryption, no
 * filtering, no foreground service. Everything below is throwaway UI whose only
 * job is to make the capture visible.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <CaptureScreen />
    </SafeAreaProvider>
  );
}

function CaptureScreen() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<CapturedNotification[]>([]);

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

  useEffect(() => {
    const sub = NotificationListener.addNotificationListener((notification) => {
      setItems((prev) => [notification, ...prev].slice(0, 200));
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="auto" />

      <View style={styles.header}>
        <Text style={styles.title}>NotifSync</Text>
        <Text style={styles.subtitle}>M0 capture spike — no network</Text>
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
        keyExtractor={(item) => item.key}
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
