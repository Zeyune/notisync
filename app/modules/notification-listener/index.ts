import { NativeModule, requireNativeModule } from "expo";

/**
 * One notification as captured by the Android NotificationListenerService.
 *
 * Mirrors FR-6's field list (notification-sync-prd.md §6.2) minus the app icon,
 * which §12 Q5 defers to v2 because shipping icon bytes pushes payloads past the
 * 4 KB push limit far more often.
 */
export type CapturedNotification = {
  /** StatusBarNotification.key — stable per notification, used for dedupe later. */
  key: string;
  packageName: string;
  /** Human-readable app name, or null if the package could not be resolved. */
  appLabel: string | null;
  title: string | null;
  body: string | null;
  /** Epoch milliseconds, from StatusBarNotification.postTime. */
  postTime: number;
  /** Ongoing notifications (media, foreground services) — excluded by default per FR-7. */
  ongoing: boolean;
  /** Posted without sound/vibration. */
  silent: boolean;
};

type NotificationListenerEvents = {
  onNotificationPosted: (notification: CapturedNotification) => void;
};

declare class NotificationListenerNativeModule extends NativeModule<NotificationListenerEvents> {
  /** Whether the user has granted this app notification access in system settings. */
  isEnabled(): boolean;
  /** Opens the system Notification access screen (FR-5). */
  openSettings(): void;
  /**
   * Asks the system to rebind the listener. Call whenever access is granted but
   * events are not arriving — notably after an app update, which silently breaks
   * the binding while leaving the grant intact.
   */
  requestRebind(): void;
}

const Native = requireNativeModule<NotificationListenerNativeModule>(
  "NotificationListener",
);

export default {
  isEnabled: (): boolean => Native.isEnabled(),
  openSettings: (): void => Native.openSettings(),
  requestRebind: (): void => Native.requestRebind(),
  addNotificationListener: (
    listener: (notification: CapturedNotification) => void,
  ) => Native.addListener("onNotificationPosted", listener),
};
