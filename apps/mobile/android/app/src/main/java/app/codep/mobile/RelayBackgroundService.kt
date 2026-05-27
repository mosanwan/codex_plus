package app.codep.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import app.codep.mobile.data.AppPreferences
import app.codep.mobile.data.RelayConnection
import app.codep.mobile.data.RelayEventRecord
import app.codep.mobile.data.RelayListener
import app.codep.mobile.data.RelayRepository
import app.codep.mobile.data.commandJson
import app.codep.mobile.data.eventFromPayload
import app.codep.mobile.data.eventsFromBacklog
import app.codep.mobile.data.parseRelayEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.min

class RelayBackgroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var preferences: AppPreferences
    private lateinit var repository: RelayRepository
    private lateinit var notificationHelper: NotificationHelper
    private var connection: RelayConnection? = null
    private var reconnectJob: Job? = null
    private var generation = 0
    private var reconnectAttempt = 0
    private var lastEventId = 0L

    override fun onCreate() {
        super.onCreate()
        preferences = AppPreferences(applicationContext)
        repository = RelayRepository()
        notificationHelper = NotificationHelper(applicationContext)
        notificationHelper.ensureChannel()
        ensureServiceChannel()
        startAsForeground()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        scope.launch { connectFromSettings() }
        return START_STICKY
    }

    override fun onDestroy() {
        reconnectJob?.cancel()
        connection?.close()
        repository.close()
        scope.coroutineContext[Job]?.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun connectFromSettings() {
        val settings = preferences.read()
        lastEventId = settings.lastEventId
        if (
            settings.relayEndpoint.isBlank() ||
            settings.relayApiKey.isBlank() ||
            settings.desktopDeviceId.isBlank()
        ) {
            stopSelf()
            return
        }
        val currentGeneration = ++generation
        reconnectJob?.cancel()
        connection?.close()
        connection = repository.connect(
            endpoint = settings.relayEndpoint,
            apiKey = settings.relayApiKey,
            desktopDeviceId = settings.desktopDeviceId,
            clientDeviceId = settings.clientDeviceId,
            listener = object : RelayListener {
                override fun onOpen() {
                    if (currentGeneration != generation) return
                    scope.launch {
                        reconnectAttempt = 0
                        publish("client.resume_events", buildJsonObject { put("last_event_id", lastEventId) })
                    }
                }

                override fun onMessage(text: String) {
                    if (currentGeneration != generation) return
                    scope.launch { applyRelayMessage(text) }
                }

                override fun onClosed(reason: String) {
                    if (currentGeneration != generation) return
                    scheduleReconnect()
                }

                override fun onFailure(message: String) {
                    if (currentGeneration != generation) return
                    scheduleReconnect()
                }
            }
        )
    }

    private fun scheduleReconnect() {
        connection = null
        val reconnectGeneration = generation
        val delayMs = min(30_000L, 1_000L shl min(reconnectAttempt, 5))
        reconnectAttempt += 1
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(delayMs)
            if (reconnectGeneration == generation) {
                connectFromSettings()
            }
        }
    }

    private suspend fun applyRelayMessage(text: String) {
        val envelope = parseRelayEnvelope(text) ?: return
        when (envelope.type) {
            "event.deliver" -> eventFromPayload(envelope.payload)?.let { handleRelayEvent(it) }
            "event.backlog" -> {
                val events = eventsFromBacklog(envelope.payload)
                events.forEach { handleRelayEvent(it) }
                if (events.isNotEmpty()) {
                    publish("client.resume_events", buildJsonObject { put("last_event_id", lastEventId) })
                }
            }
        }
    }

    private suspend fun handleRelayEvent(event: RelayEventRecord) {
        if (event.id <= lastEventId) return
        if (
            event.type == "turn.completed" &&
            preferences.read().notificationsEnabled &&
            !AppVisibility.foreground
        ) {
            notificationHelper.notifyTurnCompleted(event)
        }
        lastEventId = maxOf(lastEventId, event.id)
        preferences.saveLastEventId(lastEventId)
        publish("event.ack", buildJsonObject { put("last_event_id", lastEventId) })
    }

    private fun publish(type: String, payload: JsonObject = buildJsonObject { }) {
        connection?.send(commandJson(type, payload))
    }

    private fun ensureServiceChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            ServiceChannelId,
            "Codex+ 后台运行",
            NotificationManager.IMPORTANCE_MIN
        ).apply {
            description = "保持后台监听桌面端任务完成状态。"
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun startAsForeground() {
        val notification: Notification = NotificationCompat.Builder(this, ServiceChannelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Codex+ 正在后台运行")
            .setContentText("监听桌面端任务完成状态")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setLocalOnly(true)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                ServiceNotificationId,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(ServiceNotificationId, notification)
        }
    }

    companion object {
        private const val ServiceChannelId = "codep_relay_background_silent_v1"
        private const val ServiceNotificationId = 41

        fun start(context: Context) {
            val intent = Intent(context, RelayBackgroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RelayBackgroundService::class.java))
        }
    }
}
