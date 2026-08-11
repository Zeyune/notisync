package expo.modules.notificationlistener

import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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

    /** Deep-links to the system Notification access screen (FR-5). */
    Function("openSettings") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      context.startActivity(
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }

    OnStartObserving("onNotificationPosted") {
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
      NotifSyncListenerService.emitter = null
    }

    // The service outlives the JS runtime, so a stale emitter would hold a
    // reference to a dead context. Clear it when the module goes away.
    OnDestroy {
      NotifSyncListenerService.emitter = null
    }
  }
}
