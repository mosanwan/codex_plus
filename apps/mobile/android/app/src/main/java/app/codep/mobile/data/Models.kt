package app.codep.mobile.data

enum class RelayConnectionState {
    Disabled,
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error
}

enum class MobileTab {
    Chat,
    Sessions,
    Settings
}

enum class ComposerCompletionMode {
    File,
    Skill
}

data class Device(
    val id: String = "desktop-main",
    val name: String = "desktop",
    val workspace: String = "",
    val connection: String = "offline",
    val lastSeen: String = ""
)

data class Session(
    val id: String,
    val title: String,
    val updatedAt: String = "",
    val status: String = "ready",
    val iconId: String? = null,
    val unread: Boolean = false,
    val favorite: Boolean = false,
    val activeTurnId: String? = null,
    val turnStartedAt: Long? = null,
    val lastTurnDurationMs: Long? = null
)

data class Workspace(
    val path: String,
    val name: String,
    val sessions: List<Session> = emptyList()
)

data class MessageAttachment(
    val id: String,
    val kind: String,
    val name: String,
    val mimeType: String = "",
    val dataUrl: String = "",
    val path: String = ""
)

data class Message(
    val id: String,
    val role: String,
    val text: String,
    val meta: String = "",
    val attachments: List<MessageAttachment> = emptyList()
)

data class ComposerSuggestion(
    val id: String,
    val type: ComposerCompletionMode,
    val label: String,
    val name: String,
    val detail: String = "",
    val insertText: String,
    val path: String = ""
)

data class ComposerCompletion(
    val mode: ComposerCompletionMode,
    val query: String,
    val tokenStart: Int,
    val cursor: Int,
    val items: List<ComposerSuggestion> = emptyList(),
    val selectedIndex: Int = 0,
    val loading: Boolean = true,
    val requestId: String
)

data class Approval(
    val id: String,
    val title: String,
    val detail: String,
    val risk: String = "medium"
)

data class ContextUsage(
    val usedTokens: Long,
    val contextWindow: Long?
)

data class RateLimitUsage(
    val primaryLeftPercent: Double?,
    val secondaryLeftPercent: Double?
)

data class ModelOption(
    val id: String,
    val label: String
)

data class DesktopSnapshot(
    val device: Device? = null,
    val workspaces: List<Workspace>? = null,
    val activeWorkspace: String? = null,
    val sessions: List<Session>? = null,
    val activeSessionId: String? = null,
    val messages: List<Message>? = null,
    val approvals: List<Approval>? = null,
    val diffLines: List<String>? = null,
    val isWorking: Boolean? = null,
    val permissionMode: String? = null,
    val model: String? = null,
    val modelEffort: String? = null,
    val contextUsage: ContextUsage? = null,
    val rateLimitUsage: RateLimitUsage? = null,
    val modelOptions: List<ModelOption>? = null,
    val status: String? = null
)

data class RelayDesktopDevice(
    val deviceId: String,
    val desktopCount: Int,
    val clientCount: Int,
    val connected: Boolean,
    val lastSeen: String
)

data class RelayPresence(
    val deviceId: String = "",
    val desktopCount: Int = 0,
    val clientCount: Int = 0,
    val connected: Boolean = false,
    val lastSeen: String = ""
)

data class RelayEventRecord(
    val id: Long,
    val type: String,
    val workspaceId: String? = null,
    val sessionId: String? = null,
    val title: String? = null,
    val body: String? = null,
    val payload: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap(),
    val createdAt: String? = null
)

data class PendingRelayCommand(
    val id: String,
    val type: String,
    val payload: Map<String, kotlinx.serialization.json.JsonElement>,
    val createdAt: Long
)
