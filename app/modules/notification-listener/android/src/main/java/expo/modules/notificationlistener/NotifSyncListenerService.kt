package expo.modules.notificationlistener

import android.app.Notification
import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * Captures notifications posted on this device (FR-6).
 *
 * Lifecycle note, which matters more than it looks (PRD §12 Q8, FR-23): this
 * service is bound and restarted by the system. It is not kept alive by a
 * foreground service, and it does not need one to survive a reboot. When the
 * system drops the binding — an app update is the common case — [requestRebind]
 * is the documented way back, and it is the only call that is legal between
 * [onListenerDisconnected] and the next [onListenerConnected].
 */
class NotifSyncListenerService : NotificationListenerService() {

  companion object {
    private const val TAG = "NotifSyncListener"

    /**
     * Set by [NotificationListenerModule] while the JS module is alive.
     *
     * The system owns this service's lifecycle and JS owns the module's, so the
     * two overlap only some of the time. A null emitter means nothing is
     * listening right now — notifications are dropped rather than queued, which
     * is correct for the M0 spike and becomes the sender-side queue at M3.
     */
    @Volatile
    var emitter: ((CapturedNotification) -> Unit)? = null
  }

  /** Plain carrier so the module layer decides how to serialise. */
  data class CapturedNotification(
    val key: String,
    val packageName: String,
    val appLabel: String?,
    val title: String?,
    val body: String?,
    val postTime: Long,
    val ongoing: Boolean,
    val silent: Boolean,
  )

  override fun onListenerConnected() {
    super.onListenerConnected()
    Log.i(TAG, "listener connected")
  }

  override fun onListenerDisconnected() {
    super.onListenerDisconnected()
    Log.w(TAG, "listener disconnected — requesting rebind")
    requestRebind(ComponentName(this, NotifSyncListenerService::class.java))
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val emit = emitter
    if (emit == null) {
      // Not an error: the service outlives the JS runtime, so posts arriving
      // while nothing is listening are dropped by design at M0.
      Log.d(TAG, "dropped ${sbn.packageName} — no JS listener attached")
      return
    }
    Log.d(TAG, "captured ${sbn.packageName} key=${sbn.key}")

    val extras: Bundle = sbn.notification.extras
    val flags = sbn.notification.flags

    emit(
      CapturedNotification(
        key = sbn.key,
        packageName = sbn.packageName,
        appLabel = resolveAppLabel(sbn.packageName),
        title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
        body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
        postTime = sbn.postTime,
        // FR-7 excludes these by default at M4; M0 only reports the flag.
        ongoing = (flags and Notification.FLAG_ONGOING_EVENT) != 0,
        silent = sbn.notification.audioAttributes == null &&
          sbn.notification.sound == null &&
          sbn.notification.vibrate == null,
      ),
    )
  }

  /**
   * Package name → human-readable app name.
   *
   * Returns null rather than throwing when the package has been uninstalled
   * between posting and capture, which is rare but real.
   */
  private fun resolveAppLabel(packageName: String): String? = try {
    val pm = packageManager
    pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
  } catch (e: PackageManager.NameNotFoundException) {
    Log.d(TAG, "no label for $packageName", e)
    null
  }
}
