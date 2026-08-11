package expo.modules.notificationlistener

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Same tag as the service, so `adb logcat -s NotifSyncListener` shows both sides. */
private const val TAG = "NotifSyncListener"

/**
 * JS bridge for [NotifSyncListenerService].
 *
 * Deliberately thin: the M0 spike (PRD §10) proves capture works and nothing
 * else. No filtering, no dedupe, no network.
 */
class NotificationListenerModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("NotificationListener")

    Events("onNotificationPosted")

    /**
     * Whether the user granted notification access.
     *
     * This is a special-access grant made in a system settings screen, not a
     * runtime permission dialog, so there is no request() counterpart — FR-5
     * requires deep-linking to settings and handling the user backing out.
     */
    Function("isEnabled") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      NotificationManagerCompat.getEnabledListenerPackages(context)
        .contains(context.packageName)
    }

    /**
     * Asks the system to (re)bind the listener service.
     *
     * Necessary because reinstalling or updating the app breaks the binding
     * while leaving the grant in place: `enabled_notification_listeners` still
     * names the service, the UI still reports "granted", and no notification is
     * ever delivered. [NotifSyncListenerService.onListenerDisconnected] cannot
     * recover this on its own — the service is never constructed in the new
     * process, so the callback never runs. This is a static request that works
     * without a live instance.
     *
     * Safe to call when already connected; the system ignores it.
     */
    Function("requestRebind") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      Log.i(TAG, "requesting rebind")
      NotificationListenerService.requestRebind(
        ComponentName(context, NotifSyncListenerService::class.java),
      )
    }

    /** Deep-links to the system Notification access screen (FR-5). */
    Function("openSettings") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      context.startActivity(
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }

    OnStartObserving("onNotificationPosted") {
      Log.i(TAG, "JS attached — emitter installed")
      NotifSyncListenerService.emitter = { notification ->
        sendEvent(
          "onNotificationPosted",
          mapOf(
            "key" to notification.key,
            "packageName" to notification.packageName,
            "appLabel" to notification.appLabel,
            "title" to notification.title,
            "body" to notification.body,
            "postTime" to notification.postTime,
            "ongoing" to notification.ongoing,
            "silent" to notification.silent,
          ),
        )
      }
    }

    OnStopObserving("onNotificationPosted") {
      Log.i(TAG, "JS detached — emitter cleared")
      NotifSyncListenerService.emitter = null
    }

    // The service outlives the JS runtime, so a stale emitter would hold a
    // reference to a dead context. Clear it when the module goes away.
    OnDestroy {
      NotifSyncListenerService.emitter = null
    }
  }
}
