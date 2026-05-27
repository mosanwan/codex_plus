package app.codep.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.Closeable
import java.util.concurrent.TimeUnit

class RelayRepository : Closeable {
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    suspend fun fetchDesktopDevices(
        endpoint: String,
        apiKey: String
    ): Result<List<RelayDesktopDevice>> = withContext(Dispatchers.IO) {
        val url = relayDevicesUrl(endpoint)
            ?: return@withContext Result.failure(IllegalArgumentException("Invalid relay endpoint"))
        val request = Request.Builder()
            .url(url)
            .header("X-CodeP-Api-Key", apiKey)
            .build()
        runCatching {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    error("Relay returned HTTP ${response.code}")
                }
                val body = response.body?.string().orEmpty()
                val payload = RelayJson.parseToJsonElement(body)
                desktopDevicesFromPayload(payload)
            }
        }
    }

    fun connect(
        endpoint: String,
        apiKey: String,
        desktopDeviceId: String,
        clientDeviceId: String,
        backgroundMode: Boolean = false,
        listener: RelayListener
    ): RelayConnection {
        val url = relayWebSocketUrl(
            endpoint = endpoint,
            role = "client",
            deviceId = desktopDeviceId,
            apiKey = apiKey,
            clientDeviceId = clientDeviceId,
            backgroundMode = backgroundMode
        ) ?: throw IllegalArgumentException("Invalid relay endpoint")
        val request = Request.Builder().url(url).build()
        val socket = client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    listener.onOpen()
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    listener.onMessage(text)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    listener.onClosed("Relay connection closed")
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    listener.onFailure(t.message ?: "Relay connection failed")
                }
            }
        )
        return RelayConnection(socket)
    }

    override fun close() {
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }
}

class RelayConnection(private val socket: WebSocket) : Closeable {
    fun send(text: String): Boolean = socket.send(text)

    override fun close() {
        socket.close(1000, "closed")
    }
}

interface RelayListener {
    fun onOpen()
    fun onMessage(text: String)
    fun onClosed(reason: String)
    fun onFailure(message: String)
}

private fun relayDevicesUrl(endpoint: String): String? {
    val base = relayHttpBaseUrl(endpoint) ?: return null
    val path = base.encodedPath.trimEnd('/')
    return base.newBuilder()
        .encodedPath("$path/api/auth/devices")
        .query(null)
        .fragment(null)
        .build()
        .toString()
}

private fun relayHttpBaseUrl(endpoint: String): okhttp3.HttpUrl? {
    val normalized = normalizeRelayEndpoint(endpoint)
    val httpEndpoint = when {
        normalized.startsWith("ws://") -> "http://${normalized.removePrefix("ws://")}"
        normalized.startsWith("wss://") -> "https://${normalized.removePrefix("wss://")}"
        else -> normalized
    }
    val url = httpEndpoint.toHttpUrlOrNull() ?: return null
    if (url.scheme != "http" && url.scheme != "https") return null
    return url
}

private fun relayWebSocketUrl(
    endpoint: String,
    role: String,
    deviceId: String,
    apiKey: String,
    clientDeviceId: String,
    backgroundMode: Boolean = false
): String? {
    val base = relayHttpBaseUrl(endpoint) ?: return null
    val path = base.encodedPath.trimEnd('/')
    val builder = base.newBuilder()
        .encodedPath("$path/ws/$role")
        .addQueryParameter("device_id", deviceId)
        .addQueryParameter("api_key", apiKey)
        .addQueryParameter("client_device_id", clientDeviceId)
    if (role == "client" && backgroundMode) {
        builder.addQueryParameter("background", "1")
    }
    val httpUrl = builder
        .build()
        .toString()
    return when {
        httpUrl.startsWith("https://") -> "wss://${httpUrl.removePrefix("https://")}"
        httpUrl.startsWith("http://") -> "ws://${httpUrl.removePrefix("http://")}"
        else -> null
    }
}
