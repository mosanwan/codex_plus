package app.codep.mobile.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

val RelayJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

private const val ParsedMessageLimit = 240

data class RelayEnvelope(
    val type: String,
    val payload: JsonElement? = null
)

fun parseRelayEnvelope(text: String): RelayEnvelope? {
    val root = runCatching { RelayJson.parseToJsonElement(text).jsonObject }.getOrNull()
        ?: return null
    val type = root.string("type")
    if (type.isBlank()) return null
    return RelayEnvelope(type = type, payload = root["payload"])
}

fun commandJson(type: String, payload: JsonObject = buildJsonObject { }): String {
    return buildJsonObject {
        put("type", type)
        put("payload", payload)
    }.toString()
}

fun JsonObject.string(key: String): String {
    return (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
}

fun JsonObject.optionalString(key: String): String? {
    return (this[key] as? JsonPrimitive)?.contentOrNull
}

fun JsonObject.boolean(key: String): Boolean {
    return (this[key] as? JsonPrimitive)?.booleanOrNull ?: false
}

fun JsonObject.long(key: String): Long {
    return (this[key] as? JsonPrimitive)?.longOrNull ?: 0L
}

fun JsonObject.doubleOrNull(key: String): Double? {
    return (this[key] as? JsonPrimitive)?.doubleOrNull
}

fun JsonObject.int(key: String): Int {
    return long(key).toInt()
}

fun JsonObject.objectOrNull(key: String): JsonObject? {
    val value = this[key]
    return if (value is JsonObject) value else null
}

fun JsonObject.array(key: String): JsonArray {
    val value = this[key]
    return if (value is JsonArray) value else JsonArray(emptyList())
}

fun desktopDevicesFromPayload(payload: JsonElement?): List<RelayDesktopDevice> {
    val root = payload as? JsonObject ?: return emptyList()
    return root.array("devices")
        .mapNotNull { it as? JsonObject }
        .mapNotNull { item ->
            val deviceId = item.string("device_id")
            if (deviceId.isBlank()) return@mapNotNull null
            RelayDesktopDevice(
                deviceId = deviceId,
                desktopCount = item.int("desktop_count"),
                clientCount = item.int("client_count"),
                connected = item.boolean("connected"),
                lastSeen = item.string("last_seen")
            )
        }
        .filter { it.desktopCount > 0 || it.connected }
        .sortedWith(compareByDescending<RelayDesktopDevice> { it.connected }.thenBy { it.deviceId })
}

fun presenceFromPayload(payload: JsonElement?): RelayPresence {
    val root = payload as? JsonObject ?: return RelayPresence()
    return RelayPresence(
        deviceId = root.string("device_id"),
        desktopCount = root.int("desktop_count"),
        clientCount = root.int("client_count"),
        connected = root.boolean("connected"),
        lastSeen = root.string("last_seen")
    )
}

fun eventFromPayload(payload: JsonElement?): RelayEventRecord? {
    val root = payload as? JsonObject ?: return null
    val event = root.objectOrNull("event") ?: return null
    return normalizeEvent(event)
}

fun eventsFromBacklog(payload: JsonElement?): List<RelayEventRecord> {
    val root = payload as? JsonObject ?: return emptyList()
    return root.array("events").mapNotNull { it as? JsonObject }.mapNotNull(::normalizeEvent)
}

fun normalizeEvent(event: JsonObject): RelayEventRecord? {
    val id = event.long("id")
    val type = event.string("type")
    if (id <= 0 || type.isBlank()) return null
    val payload = event.objectOrNull("payload")?.toMap().orEmpty()
    return RelayEventRecord(
        id = id,
        type = type,
        workspaceId = event.optionalString("workspace_id"),
        sessionId = event.optionalString("session_id"),
        title = event.optionalString("title"),
        body = event.optionalString("body"),
        payload = payload,
        createdAt = event.optionalString("created_at")
    )
}

fun snapshotFromEvent(event: RelayEventRecord): DesktopSnapshot? {
    val payloadObject = JsonObject(event.payload)
    val nested = payloadObject.objectOrNull("snapshot")
    val source = nested ?: payloadObject
    return if (source.isEmpty()) null else snapshotFromPayload(source)
}

fun snapshotFromPayload(payload: JsonElement?): DesktopSnapshot? {
    val root = payload as? JsonObject ?: return null
    return DesktopSnapshot(
        device = root.objectOrNull("device")?.let(::deviceFromJson),
        workspaces = root["workspaces"]?.let(::workspacesFromJson),
        activeWorkspace = root.optionalString("activeWorkspace"),
        sessions = root["sessions"]?.let(::sessionsFromJson),
        activeSessionId = root.optionalString("activeSessionId"),
        messages = root["messages"]?.let(::messagesFromJson),
        approvals = root["approvals"]?.let(::approvalsFromJson),
        diffLines = root["diffLines"]?.let(::stringListFromJson),
        isWorking = (root["isWorking"] as? JsonPrimitive)?.booleanOrNull,
        permissionMode = root.optionalString("permissionMode"),
        model = root.optionalString("model"),
        modelEffort = root.optionalString("modelEffort"),
        contextUsage = root.objectOrNull("contextUsage")?.let {
            ContextUsage(
                usedTokens = it.long("usedTokens"),
                contextWindow = if (it["contextWindow"] == null || it["contextWindow"] is JsonNull) {
                    null
                } else {
                    it.long("contextWindow")
                }
            )
        },
        rateLimitUsage = root.objectOrNull("rateLimitUsage")?.let {
            RateLimitUsage(
                primaryLeftPercent = it.objectOrNull("primary")?.doubleOrNull("leftPercent"),
                secondaryLeftPercent = it.objectOrNull("secondary")?.doubleOrNull("leftPercent")
            )
        },
        modelOptions = root["modelOptions"]?.let(::modelOptionsFromJson),
        status = root.optionalString("status"),
        appVersion = root.optionalString("appVersion"),
        releaseUrl = root.optionalString("releaseUrl")
    )
}

fun messageFromPayload(payload: JsonElement?): Message? {
    return (payload as? JsonObject)?.let(::messageFromJson)
}

fun progressSessionId(payload: JsonElement?): String {
    return (payload as? JsonObject)?.string("sessionId").orEmpty()
}

fun progressIsWorking(payload: JsonElement?): Boolean? {
    val root = payload as? JsonObject ?: return null
    return (root["isWorking"] as? JsonPrimitive)?.booleanOrNull
}

fun progressMessage(payload: JsonElement?): Message? {
    val root = payload as? JsonObject ?: return null
    return root.objectOrNull("message")?.let(::messageFromJson)
        ?: root.objectOrNull("event")?.let(::messageFromJson)
}

fun desktopEventMessage(payload: JsonElement?): Pair<String, Message>? {
    val event = (payload as? JsonObject)?.objectOrNull("event") ?: return null
    val sessionId = event.string("threadId")
    val text = listOf("patch", "diff", "plan", "summary")
        .firstNotNullOfOrNull { key -> event.optionalString(key)?.takeIf { it.isNotBlank() } }
        ?: return null
    val type = event.string("type").ifBlank { "desktop.event" }
    val turnId = event.string("turnId")
    val id = "event-$type-${turnId.ifBlank { sessionId.ifBlank { text.hashCode().toString() } }}"
    return sessionId to Message(
        id = id,
        role = "event",
        text = text,
        meta = type
    )
}

private fun deviceFromJson(root: JsonObject): Device {
    return Device(
        id = root.string("id"),
        name = root.string("name"),
        workspace = root.string("workspace"),
        connection = root.string("connection").ifBlank { "offline" },
        lastSeen = root.string("lastSeen")
    )
}

private fun workspacesFromJson(value: JsonElement): List<Workspace> {
    return value.jsonArray.mapNotNull { it as? JsonObject }.map { root ->
        Workspace(
            path = root.string("path"),
            name = root.string("name"),
            sessions = sessionsFromJson(root.array("sessions"))
        )
    }
}

private fun sessionsFromJson(value: JsonElement): List<Session> {
    return value.jsonArray.mapNotNull { it as? JsonObject }.mapNotNull { root ->
        val id = root.string("id")
        if (id.isBlank()) return@mapNotNull null
        Session(
            id = id,
            title = root.string("title").ifBlank { "Untitled session" },
            updatedAt = root.string("updatedAt"),
            status = root.string("status").ifBlank { "ready" },
            iconId = root.optionalString("iconId"),
            unread = root.boolean("unread"),
            favorite = root.boolean("favorite"),
            activeTurnId = root.optionalString("activeTurnId"),
            turnStartedAt = root.optionalString("turnStartedAt")?.toLongOrNull(),
            lastTurnDurationMs = root.optionalString("lastTurnDurationMs")?.toLongOrNull()
        )
    }
}

private fun messagesFromJson(value: JsonElement): List<Message> {
    return value.jsonArray.takeLast(ParsedMessageLimit)
        .mapNotNull { it as? JsonObject }
        .mapNotNull(::messageFromJson)
}

private fun messageFromJson(root: JsonObject): Message? {
    val id = root.string("id")
    if (id.isBlank()) return null
    return Message(
        id = id,
        role = root.string("role"),
        text = root.string("text"),
        meta = root.string("meta"),
        attachments = root["attachments"]?.let(::attachmentsFromJson).orEmpty()
    )
}

private fun attachmentsFromJson(value: JsonElement): List<MessageAttachment> {
    return value.jsonArray.mapNotNull { it as? JsonObject }.map { root ->
        MessageAttachment(
            id = root.string("id"),
            kind = root.string("kind"),
            name = root.string("name"),
            mimeType = root.string("mimeType"),
            dataUrl = root.string("dataUrl"),
            path = root.string("path")
        )
    }
}

private fun approvalsFromJson(value: JsonElement): List<Approval> {
    return value.jsonArray.mapNotNull { it as? JsonObject }.mapNotNull { root ->
        val id = root.string("id")
        if (id.isBlank()) return@mapNotNull null
        Approval(
            id = id,
            title = root.string("title"),
            detail = root.string("detail"),
            risk = root.string("risk").ifBlank { "medium" }
        )
    }
}

private fun stringListFromJson(value: JsonElement): List<String> {
    return value.jsonArray.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
}

private fun modelOptionsFromJson(value: JsonElement): List<ModelOption> {
    return value.jsonArray.mapNotNull { it as? JsonObject }.mapNotNull { root ->
        val id = root.string("id")
        if (id.isBlank()) return@mapNotNull null
        ModelOption(id = id, label = root.string("label").ifBlank { id })
    }
}
