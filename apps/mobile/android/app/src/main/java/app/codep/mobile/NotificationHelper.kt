package app.codep.mobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.codep.mobile.data.RelayEventRecord
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

class NotificationHelper(private val context: Context) {
    private val channelId = "codep_turn_complete_alerts_v1"

    fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val channel = NotificationChannel(
            channelId,
            "Codex+ turn alerts",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Notifications shown when a Codex turn completes."
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 180, 90, 220)
            setSound(soundUri, audioAttributes)
        }
        manager.createNotificationChannel(channel)
    }

    fun notifyTurnCompleted(event: RelayEventRecord) {
        if (event.type != "turn.completed") return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }
        ensureChannel()
        val sessionTitle = event.payloadText("session_title")
        val title = event.title?.takeIf { it.isNotBlank() } ?: sessionTitle ?: "Codex+"
        val body = event.payloadText("notification_body")
            ?: event.payloadText("final_message")
            ?: event.body?.takeIf { it.isNotBlank() }
            ?: sessionTitle?.let { "$it completed." }
            ?: "A Codex turn completed."
        val contentIntent = Intent(context, MainActivity::class.java).apply {
            action = MainActivity.ACTION_OPEN_SESSION
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_SESSION_ID, event.sessionId.orEmpty())
            putExtra(MainActivity.EXTRA_WORKSPACE_ID, event.workspaceId.orEmpty())
            putExtra(MainActivity.EXTRA_EVENT_ID, event.id)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            event.id.toInt(),
            contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(cleanNotificationText(body))
            .setStyle(NotificationCompat.BigTextStyle().bigText(cleanNotificationText(body)))
            .setContentIntent(pendingIntent)
            .setTicker(title)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            .setVibrate(longArrayOf(0, 180, 90, 220))
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(event.id.toInt(), notification)
    }

    private fun cleanNotificationText(value: String): String {
        return value
            .replace(Regex("```[\\s\\S]*?```"), " ")
            .replace(Regex("`([^`]+)`"), "$1")
            .replace(Regex("[*_~>#-]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(140)
    }

    private fun RelayEventRecord.payloadText(key: String): String? {
        return (payload[key] as? JsonPrimitive)
            ?.contentOrNull
            ?.trim()
            ?.takeIf { it.isNotBlank() }
    }
}
