package app.codep.mobile

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.codep.mobile.data.AppPreferences
import app.codep.mobile.data.AppSettings
import app.codep.mobile.data.AppLanguage
import app.codep.mobile.data.AppThemeMode
import app.codep.mobile.data.DEFAULT_RELAY_ENDPOINT
import app.codep.mobile.data.Approval
import app.codep.mobile.data.ComposerCompletion
import app.codep.mobile.data.ComposerCompletionMode
import app.codep.mobile.data.ComposerSuggestion
import app.codep.mobile.data.DesktopSnapshot
import app.codep.mobile.data.Message
import app.codep.mobile.data.MessageAttachment
import app.codep.mobile.data.MobileTab
import app.codep.mobile.data.ModelOption
import app.codep.mobile.data.RelayConnection
import app.codep.mobile.data.RelayConnectionState
import app.codep.mobile.data.RelayDesktopDevice
import app.codep.mobile.data.RelayEventRecord
import app.codep.mobile.data.RelayListener
import app.codep.mobile.data.RelayPresence
import app.codep.mobile.data.RelayRepository
import app.codep.mobile.data.Session
import app.codep.mobile.data.Workspace
import app.codep.mobile.data.commandJson
import app.codep.mobile.data.eventFromPayload
import app.codep.mobile.data.eventsFromBacklog
import app.codep.mobile.data.normalizeRelayEndpoint
import app.codep.mobile.data.parseRelayEnvelope
import app.codep.mobile.data.presenceFromPayload
import app.codep.mobile.data.snapshotFromEvent
import app.codep.mobile.data.snapshotFromPayload
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.util.UUID
import kotlin.math.min

private const val StoredMessageLimit = 240

data class MobileUiState(
    val selectedTab: MobileTab = MobileTab.Chat,
    val relayEndpoint: String = DEFAULT_RELAY_ENDPOINT,
    val relayApiKey: String = "",
    val desktopDeviceId: String = "",
    val clientDeviceId: String = "",
    val lastEventId: Long = 0,
    val notificationsEnabled: Boolean = true,
    val themeMode: AppThemeMode = AppThemeMode.Dark,
    val language: AppLanguage = AppLanguage.English,
    val relayState: RelayConnectionState = RelayConnectionState.Disabled,
    val relayError: String = "",
    val relayPresence: RelayPresence? = null,
    val desktopDevices: List<RelayDesktopDevice> = emptyList(),
    val devicesLoading: Boolean = false,
    val device: app.codep.mobile.data.Device = app.codep.mobile.data.Device(),
    val workspaces: List<Workspace> = emptyList(),
    val activeWorkspace: String? = null,
    val sessions: List<Session> = emptyList(),
    val activeSessionId: String? = null,
    val messages: List<Message> = emptyList(),
    val approvals: List<Approval> = emptyList(),
    val diffLines: List<String> = emptyList(),
    val permissionMode: String = "default",
    val model: String = "gpt-5.5",
    val modelEffort: String = "high",
    val modelOptions: List<ModelOption> = defaultModelOptions(),
    val status: String = "",
    val isWorking: Boolean = false,
    val composer: String = "",
    val composerCompletion: ComposerCompletion? = null,
    val pendingAttachments: List<MessageAttachment> = emptyList(),
    val workspacePathDraft: String = ""
) {
    val activeSession: Session?
        get() = workspaces.asSequence()
            .flatMap { it.sessions.asSequence() }
            .firstOrNull { it.id == activeSessionId }
            ?: sessions.firstOrNull { it.id == activeSessionId }
            ?: sessions.firstOrNull()

    val hasRelaySettings: Boolean
        get() = relayEndpoint.isNotBlank() && relayApiKey.isNotBlank() && desktopDeviceId.isNotBlank()
}

class MobileViewModel(application: Application) : AndroidViewModel(application) {
    private val preferences = AppPreferences(application)
    private val repository = RelayRepository()
    private val notificationHelper = NotificationHelper(application)
    private val pendingCommands = linkedMapOf<String, PendingCommand>()
    private var connection: RelayConnection? = null
    private var reconnectJob: Job? = null
    private var retryJob: Job? = null
    private var reconnectAttempt = 0
    private var connectionGeneration = 0
    private var composerCompletionRequestCounter = 0

    private val _state = MutableStateFlow(MobileUiState())
    val state: StateFlow<MobileUiState> = _state.asStateFlow()

    init {
        notificationHelper.ensureChannel()
        viewModelScope.launch {
            val settings = preferences.read()
            applySettings(settings)
            if (settings.relayApiKey.isNotBlank()) {
                refreshDevices()
            }
            if (settings.relayEndpoint.isNotBlank() &&
                settings.relayApiKey.isNotBlank() &&
                settings.desktopDeviceId.isNotBlank()
            ) {
                connectRelay()
            }
        }
        retryJob = viewModelScope.launch {
            while (true) {
                delay(5_000)
                flushPendingCommands()
            }
        }
    }

    fun selectTab(tab: MobileTab) {
        _state.update { it.copy(selectedTab = tab) }
        if (tab == MobileTab.Sessions) {
            publishReliable("client.refresh_sessions")
        }
    }

    fun updateRelayEndpoint(value: String) {
        val normalized = normalizeRelayEndpoint(value)
        _state.update { it.copy(relayEndpoint = normalized) }
        viewModelScope.launch { preferences.saveRelayEndpoint(normalized) }
    }

    fun updateRelayApiKey(value: String) {
        _state.update { it.copy(relayApiKey = value) }
        viewModelScope.launch { preferences.saveRelayApiKey(value) }
    }

    fun updateDesktopDeviceId(value: String) {
        _state.update { it.copy(desktopDeviceId = value) }
        viewModelScope.launch { preferences.saveDesktopDeviceId(value) }
    }

    fun updateNotificationsEnabled(value: Boolean) {
        _state.update { it.copy(notificationsEnabled = value) }
        viewModelScope.launch { preferences.saveNotificationsEnabled(value) }
    }

    fun updateThemeMode(value: AppThemeMode) {
        _state.update { it.copy(themeMode = value) }
        viewModelScope.launch { preferences.saveThemeMode(value) }
    }

    fun updateLanguage(value: AppLanguage) {
        _state.update { it.copy(language = value) }
        viewModelScope.launch { preferences.saveLanguage(value) }
    }

    fun updatePermissionMode(value: String) {
        if (value.isBlank()) return
        _state.update { it.copy(permissionMode = value) }
        publishReliable("client.set_permissions", buildJsonObject { put("permissionMode", value) })
    }

    fun updateModel(value: String) {
        val nextModel = value.trim()
        if (nextModel.isBlank()) return
        val effort = _state.value.modelEffort
        _state.update { it.copy(model = nextModel) }
        publishReliable(
            "client.set_model",
            buildJsonObject {
                put("model", nextModel)
                put("effort", effort)
            }
        )
    }

    fun updateModelEffort(value: String) {
        if (value.isBlank()) return
        val model = _state.value.model
        _state.update { it.copy(modelEffort = value) }
        publishReliable(
            "client.set_model",
            buildJsonObject {
                put("model", model)
                put("effort", value)
            }
        )
    }

    fun updateComposer(value: String) {
        val nextCompletion = completionFor(value, value.length, _state.value.composerCompletion)
        _state.update { it.copy(composer = value, composerCompletion = nextCompletion) }
        requestComposerSuggestions(nextCompletion)
    }

    fun insertComposerTrigger(trigger: String) {
        var nextCompletion: ComposerCompletion? = null
        _state.update { current ->
            val prefix = when {
                current.composer.isBlank() -> ""
                current.composer.last().isWhitespace() -> ""
                else -> " "
            }
            val nextComposer = current.composer + prefix + trigger
            nextCompletion = completionFor(nextComposer, nextComposer.length, null)
            current.copy(composer = nextComposer, composerCompletion = nextCompletion)
        }
        requestComposerSuggestions(nextCompletion)
    }

    fun selectComposerSuggestion(id: String) {
        val current = _state.value
        val completion = current.composerCompletion ?: return
        val item = completion.items.firstOrNull { it.id == id } ?: return
        val prefix = current.composer.take(completion.tokenStart)
        val suffix = current.composer.drop(completion.cursor)
        _state.update {
            it.copy(
                composer = "$prefix${item.insertText} $suffix",
                composerCompletion = null,
                pendingAttachments = if (item.type == ComposerCompletionMode.File && item.path.isNotBlank()) {
                    val exists = it.pendingAttachments.any { attachment ->
                        attachment.kind == "mention" && attachment.path == item.path
                    }
                    if (exists) {
                        it.pendingAttachments
                    } else {
                        it.pendingAttachments + MessageAttachment(
                            id = "${item.path}-${System.currentTimeMillis()}",
                            kind = "mention",
                            name = item.name,
                            path = item.path
                        )
                    }
                } else {
                    it.pendingAttachments
                }
            )
        }
    }

    fun addImageAttachments(uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            val attachments = uris.mapNotNull(::attachmentFromUri)
            if (attachments.isNotEmpty()) {
                _state.update { it.copy(pendingAttachments = it.pendingAttachments + attachments) }
            }
        }
    }

    fun removePendingAttachment(id: String) {
        _state.update {
            it.copy(pendingAttachments = it.pendingAttachments.filterNot { attachment -> attachment.id == id })
        }
    }

    fun updateWorkspacePathDraft(value: String) {
        _state.update { it.copy(workspacePathDraft = value) }
    }

    fun refreshDevices() {
        val snapshot = _state.value
        if (snapshot.relayEndpoint.isBlank() || snapshot.relayApiKey.isBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(devicesLoading = true, relayError = "") }
            repository.fetchDesktopDevices(snapshot.relayEndpoint, snapshot.relayApiKey)
                .onSuccess { devices ->
                    val selected = snapshot.desktopDeviceId.ifBlank {
                        devices.firstOrNull()?.deviceId.orEmpty()
                    }
                    if (selected.isNotBlank() && selected != snapshot.desktopDeviceId) {
                        preferences.saveDesktopDeviceId(selected)
                    }
                    _state.update {
                        it.copy(
                            desktopDevices = devices,
                            desktopDeviceId = selected,
                            devicesLoading = false
                        )
                    }
                    if (
                        selected.isNotBlank() &&
                        _state.value.relayState != RelayConnectionState.Connected &&
                        _state.value.relayState != RelayConnectionState.Connecting
                    ) {
                        connectRelay()
                    }
                }
                .onFailure { error ->
                    _state.update {
                        it.copy(
                            devicesLoading = false,
                            relayError = error.message ?: "Unable to load desktop devices"
                        )
                    }
                }
        }
    }

    fun connectRelay() {
        val snapshot = _state.value
        if (!snapshot.hasRelaySettings) {
            _state.update {
                it.copy(
                    relayState = RelayConnectionState.Disabled,
                    relayError = "Relay endpoint, API key, and desktop device are required."
                )
            }
            return
        }
        val generation = ++connectionGeneration
        reconnectJob?.cancel()
        connection?.close()
        _state.update { it.copy(relayState = RelayConnectionState.Connecting, relayError = "") }
        runCatching {
            repository.connect(
                endpoint = snapshot.relayEndpoint,
                apiKey = snapshot.relayApiKey,
                desktopDeviceId = snapshot.desktopDeviceId,
                clientDeviceId = snapshot.clientDeviceId,
                listener = object : RelayListener {
                    override fun onOpen() {
                        if (generation != connectionGeneration) return
                        viewModelScope.launch {
                            reconnectAttempt = 0
                            _state.update {
                                it.copy(
                                    relayState = RelayConnectionState.Connected,
                                    relayError = "",
                                    relayPresence = null
                                )
                            }
                            flushPendingCommands()
                            publish(
                                "client.resume_events",
                                buildJsonObject { put("last_event_id", _state.value.lastEventId) }
                            )
                            publishReliable("client.refresh_sessions")
                        }
                    }

                    override fun onMessage(text: String) {
                        if (generation != connectionGeneration) return
                        viewModelScope.launch { applyRelayMessage(text) }
                    }

                    override fun onClosed(reason: String) {
                        if (generation != connectionGeneration) return
                        viewModelScope.launch { scheduleReconnect(reason, generation) }
                    }

                    override fun onFailure(message: String) {
                        if (generation != connectionGeneration) return
                        viewModelScope.launch { scheduleReconnect(message, generation) }
                    }
                }
            )
        }.onSuccess { next ->
            connection = next
        }.onFailure { error ->
            _state.update {
                it.copy(
                    relayState = RelayConnectionState.Error,
                    relayError = error.message ?: "Unable to connect relay"
                )
            }
        }
    }

    fun disconnectRelay() {
        connectionGeneration += 1
        reconnectJob?.cancel()
        connection?.close()
        connection = null
        _state.update {
            it.copy(
                relayState = RelayConnectionState.Disconnected,
                relayPresence = null,
                relayError = ""
            )
        }
    }

    fun sendMessage() {
        val current = _state.value
        val text = current.composer.trim()
        val attachments = current.pendingAttachments
        val sessionId = current.activeSessionId ?: current.activeSession?.id.orEmpty()
        if ((text.isBlank() && attachments.isEmpty()) || sessionId.isBlank()) return
        val workspace = current.activeWorkspace
            ?: workspaceForSession(current.workspaces, sessionId)?.path
            ?: ""
        val localMessage = Message(
            id = "local-${System.currentTimeMillis()}",
            role = "user",
            text = text.ifBlank { "Sent attachments" },
            attachments = attachments
        )
        _state.update {
            it.copy(
                messages = limitMessages(it.messages + localMessage),
                composer = "",
                pendingAttachments = emptyList(),
                selectedTab = MobileTab.Chat,
                isWorking = true
            )
        }
        publishReliable(
            "client.send_message",
            buildJsonObject {
                put("workspace", workspace)
                put("sessionId", sessionId)
                put("text", text)
                put("attachments", buildJsonArray {
                    attachments.forEach { attachment ->
                        add(
                            buildJsonObject {
                                put("kind", attachment.kind)
                                put("name", attachment.name)
                                if (attachment.kind == "mention") {
                                    put("path", attachment.path)
                                } else {
                                    put("mimeType", attachment.mimeType)
                                    put("dataUrl", attachment.dataUrl)
                                }
                            }
                        )
                    }
                })
            }
        )
    }

    fun interruptTurn() {
        _state.update { it.copy(isWorking = false) }
        publishReliable("client.interrupt")
    }

    fun openSession(sessionId: String) {
        openSession(sessionId = sessionId, workspaceOverride = null)
    }

    fun openSessionFromNotification(sessionId: String, workspace: String) {
        _state.update { it.copy(selectedTab = MobileTab.Chat) }
        if (sessionId.isBlank()) return
        openSession(sessionId = sessionId, workspaceOverride = workspace.takeIf { it.isNotBlank() })
    }

    private fun openSession(sessionId: String, workspaceOverride: String?) {
        val workspace = workspaceOverride?.let { Workspace(path = it, name = it.substringAfterLast('/')) }
            ?: workspaceForSession(_state.value.workspaces, sessionId)
        _state.update {
            it.copy(
                activeSessionId = sessionId,
                activeWorkspace = workspace?.path ?: it.activeWorkspace,
                workspaces = markSessionRead(it.workspaces, sessionId),
                sessions = it.sessions.map { session ->
                    if (session.id == sessionId) session.copy(unread = false) else session
                },
                messages = emptyList(),
                selectedTab = MobileTab.Chat,
                status = "Resuming this desktop session..."
            )
        }
        publishReliable(
            "client.open_session",
            buildJsonObject {
                put("workspace", workspace?.path.orEmpty())
                put("sessionId", sessionId)
            }
        )
    }

    fun startSession(workspace: String) {
        _state.update {
            it.copy(
                activeWorkspace = workspace,
                activeSessionId = null,
                messages = emptyList(),
                selectedTab = MobileTab.Chat,
                status = "Starting a new session..."
            )
        }
        publishReliable("client.new_session", buildJsonObject { put("workspace", workspace) })
    }

    fun openWorkspace(workspace: String) {
        if (workspace.isBlank()) return
        _state.update {
            it.copy(
                activeWorkspace = workspace,
                activeSessionId = null,
                messages = emptyList(),
                selectedTab = MobileTab.Chat,
                status = "Opening workspace..."
            )
        }
        publishReliable("client.open_workspace", buildJsonObject { put("workspace", workspace) })
    }

    fun openWorkspacePath() {
        val workspace = _state.value.workspacePathDraft.trim()
        if (workspace.isBlank()) return
        _state.update {
            it.copy(
                workspacePathDraft = "",
                activeWorkspace = workspace,
                activeSessionId = null,
                messages = emptyList(),
                selectedTab = MobileTab.Chat,
                status = "Opening workspace..."
            )
        }
        publishReliable("client.open_workspace_path", buildJsonObject { put("workspace", workspace) })
    }

    fun toggleSessionFavorite(sessionId: String) {
        if (sessionId.isBlank()) return
        val currentSession = findSession(_state.value.workspaces, _state.value.sessions, sessionId)
        val nextFavorite = !(currentSession?.favorite ?: false)
        _state.update {
            it.copy(
                workspaces = updateSessionFavorite(it.workspaces, sessionId, nextFavorite),
                sessions = it.sessions.map { session ->
                    if (session.id == sessionId) session.copy(favorite = nextFavorite) else session
                }
            )
        }
        publishReliable(
            "client.set_session_favorite",
            buildJsonObject {
                put("sessionId", sessionId)
                put("favorite", nextFavorite)
            }
        )
    }

    fun renameSession(workspace: String, sessionId: String, title: String) {
        val nextTitle = title.trim()
        if (workspace.isBlank() || sessionId.isBlank() || nextTitle.isBlank()) return
        _state.update {
            it.copy(
                workspaces = updateSessionTitle(it.workspaces, sessionId, nextTitle),
                sessions = it.sessions.map { session ->
                    if (session.id == sessionId) session.copy(title = nextTitle) else session
                },
                status = "Session renamed."
            )
        }
        publishReliable(
            "client.rename_session",
            buildJsonObject {
                put("workspace", workspace)
                put("sessionId", sessionId)
                put("title", nextTitle)
            }
        )
    }

    fun removeSession(workspace: String, sessionId: String) {
        if (workspace.isBlank() || sessionId.isBlank()) return
        _state.update {
            it.copy(
                workspaces = removeSessionFromWorkspaces(it.workspaces, sessionId),
                sessions = it.sessions.filterNot { session -> session.id == sessionId },
                activeSessionId = if (it.activeSessionId == sessionId) null else it.activeSessionId,
                messages = if (it.activeSessionId == sessionId) emptyList() else it.messages,
                status = "Session removed."
            )
        }
        publishReliable(
            "client.remove_session",
            buildJsonObject {
                put("workspace", workspace)
                put("sessionId", sessionId)
            }
        )
    }

    fun removeWorkspace(workspace: String) {
        if (workspace.isBlank()) return
        _state.update {
            val removedSessionIds = it.workspaces
                .firstOrNull { item -> item.path == workspace }
                ?.sessions
                ?.map { session -> session.id }
                ?.toSet()
                .orEmpty()
            val nextWorkspaces = it.workspaces.filterNot { item -> item.path == workspace }
            val nextActiveWorkspace = if (it.activeWorkspace == workspace) {
                nextWorkspaces.firstOrNull()?.path
            } else {
                it.activeWorkspace
            }
            it.copy(
                workspaces = nextWorkspaces,
                sessions = it.sessions.filterNot { session -> removedSessionIds.contains(session.id) },
                activeWorkspace = nextActiveWorkspace,
                activeSessionId = if (removedSessionIds.contains(it.activeSessionId)) null else it.activeSessionId,
                messages = if (removedSessionIds.contains(it.activeSessionId)) emptyList() else it.messages,
                status = "Workspace removed."
            )
        }
        publishReliable("client.remove_workspace", buildJsonObject { put("workspace", workspace) })
    }

    fun resolveApproval(approvalId: String, decision: String) {
        _state.update { it.copy(approvals = it.approvals.filterNot { approval -> approval.id == approvalId }) }
        publishReliable(
            "client.resolve_approval",
            buildJsonObject {
                put("requestId", approvalId)
                put("decision", decision)
            }
        )
    }

    private fun applySettings(settings: AppSettings) {
        _state.update {
            it.copy(
                relayEndpoint = settings.relayEndpoint,
                relayApiKey = settings.relayApiKey,
                desktopDeviceId = settings.desktopDeviceId,
                clientDeviceId = settings.clientDeviceId,
                lastEventId = settings.lastEventId,
                notificationsEnabled = settings.notificationsEnabled,
                themeMode = settings.themeMode,
                language = settings.language
            )
        }
    }

    private suspend fun scheduleReconnect(reason: String, generation: Int) {
        if (generation != connectionGeneration) return
        if (!_state.value.hasRelaySettings) return
        connection = null
        val delayMs = min(30_000L, 1_000L shl min(reconnectAttempt, 5))
        reconnectAttempt += 1
        _state.update {
            it.copy(
                relayState = RelayConnectionState.Reconnecting,
                relayPresence = null,
                relayError = "$reason. Reconnecting in ${delayMs / 1000}s."
            )
        }
        reconnectJob?.cancel()
        reconnectJob = viewModelScope.launch {
            delay(delayMs)
            if (generation == connectionGeneration) {
                connectRelay()
            }
        }
    }

    private fun publishReliable(type: String, payload: JsonObject = buildJsonObject { }) {
        val id = "${_state.value.clientDeviceId}:${UUID.randomUUID()}"
        val payloadWithId = buildJsonObject {
            payload.forEach { (key, value) -> put(key, value) }
            put("client_message_id", id)
        }
        pendingCommands[id] = PendingCommand(
            id = id,
            type = type,
            payload = payloadWithId,
            createdAt = System.currentTimeMillis()
        )
        prunePendingCommands()
        publish(type, payloadWithId)
    }

    private fun publish(type: String, payload: JsonObject = buildJsonObject { }) {
        connection?.send(commandJson(type, payload))
    }

    private fun flushPendingCommands() {
        prunePendingCommands()
        pendingCommands.values.forEach { publish(it.type, it.payload) }
    }

    private fun prunePendingCommands() {
        val now = System.currentTimeMillis()
        val stale = pendingCommands.values
            .filter { now - it.createdAt > 120_000L }
            .map { it.id }
        stale.forEach { pendingCommands.remove(it) }
    }

    private suspend fun applyRelayMessage(text: String) {
        val envelope = parseRelayEnvelope(text) ?: return
        when (envelope.type) {
            "client.command_ack" -> {
                val payload = envelope.payload as? JsonObject
                val id = (payload?.get("client_message_id") as? JsonPrimitive)
                    ?.contentOrNull
                    .orEmpty()
                if (id.isNotBlank()) pendingCommands.remove(id)
            }

            "relay.presence" -> {
                val presence = presenceFromPayload(envelope.payload)
                _state.update { it.copy(relayPresence = presence) }
            }

            "event.deliver" -> {
                eventFromPayload(envelope.payload)?.let { handleRelayEvent(it) }
            }

            "event.backlog" -> {
                val events = eventsFromBacklog(envelope.payload)
                events.forEach { handleRelayEvent(it) }
                if (events.isNotEmpty()) {
                    publish(
                        "client.resume_events",
                        buildJsonObject { put("last_event_id", _state.value.lastEventId) }
                    )
                }
            }

            "desktop.snapshot" -> {
                snapshotFromPayload(envelope.payload)?.let(::applyDesktopSnapshot)
            }

            "desktop.composer_suggestions" -> {
                handleComposerSuggestions(envelope.payload)
            }
        }
    }

    private suspend fun handleRelayEvent(event: RelayEventRecord) {
        if (event.id <= _state.value.lastEventId) return
        if (event.type == "desktop.snapshot") {
            snapshotFromEvent(event)?.let(::applyDesktopSnapshot)
        }
        if (event.type == "turn.completed") {
            _state.update {
                it.copy(
                    isWorking = false,
                    status = event.body ?: event.title ?: "Turn completed."
                )
            }
        }
        _state.update { it.copy(lastEventId = maxOf(it.lastEventId, event.id)) }
        preferences.saveLastEventId(_state.value.lastEventId)
        publish(
            "event.ack",
            buildJsonObject { put("last_event_id", _state.value.lastEventId) }
        )
    }

    private fun applyDesktopSnapshot(snapshot: DesktopSnapshot) {
        _state.update { current ->
            current.copy(
                device = snapshot.device ?: current.device,
                workspaces = snapshot.workspaces ?: current.workspaces,
                activeWorkspace = snapshot.activeWorkspace ?: current.activeWorkspace,
                sessions = snapshot.sessions ?: current.sessions,
                activeSessionId = snapshot.activeSessionId ?: current.activeSessionId,
                messages = snapshot.messages?.let(::limitMessages) ?: current.messages,
                approvals = snapshot.approvals ?: current.approvals,
                diffLines = snapshot.diffLines ?: current.diffLines,
                permissionMode = snapshot.permissionMode ?: current.permissionMode,
                model = snapshot.model ?: current.model,
                modelEffort = snapshot.modelEffort ?: current.modelEffort,
                modelOptions = snapshot.modelOptions?.takeIf { it.isNotEmpty() } ?: current.modelOptions,
                status = snapshot.status ?: current.status,
                isWorking = snapshot.isWorking ?: current.isWorking
            )
        }
    }

    private fun workspaceForSession(workspaces: List<Workspace>, sessionId: String): Workspace? {
        return workspaces.firstOrNull { workspace ->
            workspace.sessions.any { it.id == sessionId }
        }
    }

    private fun limitMessages(messages: List<Message>): List<Message> {
        return if (messages.size <= StoredMessageLimit) messages else messages.takeLast(StoredMessageLimit)
    }

    private fun findSession(workspaces: List<Workspace>, sessions: List<Session>, sessionId: String): Session? {
        return workspaces.asSequence()
            .flatMap { it.sessions.asSequence() }
            .firstOrNull { it.id == sessionId }
            ?: sessions.firstOrNull { it.id == sessionId }
    }

    private fun updateSessionFavorite(
        workspaces: List<Workspace>,
        sessionId: String,
        favorite: Boolean
    ): List<Workspace> {
        return workspaces.map { workspace ->
            workspace.copy(
                sessions = workspace.sessions.map { session ->
                    if (session.id == sessionId) session.copy(favorite = favorite) else session
                }
            )
        }
    }

    private fun updateSessionTitle(
        workspaces: List<Workspace>,
        sessionId: String,
        title: String
    ): List<Workspace> {
        return workspaces.map { workspace ->
            workspace.copy(
                sessions = workspace.sessions.map { session ->
                    if (session.id == sessionId) session.copy(title = title) else session
                }
            )
        }
    }

    private fun removeSessionFromWorkspaces(workspaces: List<Workspace>, sessionId: String): List<Workspace> {
        return workspaces.map { workspace ->
            workspace.copy(sessions = workspace.sessions.filterNot { session -> session.id == sessionId })
        }
    }

    private fun markSessionRead(workspaces: List<Workspace>, sessionId: String): List<Workspace> {
        return workspaces.map { workspace ->
            workspace.copy(
                sessions = workspace.sessions.map { session ->
                    if (session.id == sessionId) session.copy(unread = false) else session
                }
            )
        }
    }

    private fun completionFor(
        value: String,
        cursor: Int,
        previous: ComposerCompletion?
    ): ComposerCompletion? {
        if (_state.value.activeSession == null) return null
        val prefix = value.take(cursor)
        val match = Regex("""(^|\s)([@$])([^\s@$]*)$""").find(prefix) ?: return null
        val mode = if (match.groupValues[2] == "@") {
            ComposerCompletionMode.File
        } else {
            ComposerCompletionMode.Skill
        }
        val query = match.groupValues[3]
        if (previous?.mode == mode && previous.query == query) return previous
        return ComposerCompletion(
            mode = mode,
            query = query,
            tokenStart = match.range.first + match.groupValues[1].length,
            cursor = cursor,
            requestId = "completion-${System.currentTimeMillis()}-${++composerCompletionRequestCounter}"
        )
    }

    private fun requestComposerSuggestions(completion: ComposerCompletion?) {
        if (completion == null) return
        val current = _state.value
        publish(
            "client.search_composer",
            buildJsonObject {
                put("mode", if (completion.mode == ComposerCompletionMode.File) "file" else "skill")
                put("query", completion.query)
                put("requestId", completion.requestId)
                put("limit", 36)
                put(
                    "workspace",
                    current.activeWorkspace
                        ?: current.activeSessionId?.let { workspaceForSession(current.workspaces, it)?.path }
                        ?: ""
                )
            }
        )
    }

    private fun handleComposerSuggestions(payload: kotlinx.serialization.json.JsonElement?) {
        val root = payload as? JsonObject ?: return
        val requestId = (root["requestId"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        val suggestions = composerSuggestionsFromPayload(root["items"])
        _state.update { current ->
            val completion = current.composerCompletion
            if (completion == null || completion.requestId != requestId) {
                current
            } else {
                current.copy(
                    composerCompletion = completion.copy(
                        items = suggestions,
                        selectedIndex = min(completion.selectedIndex, (suggestions.size - 1).coerceAtLeast(0)),
                        loading = false
                    )
                )
            }
        }
    }

    private fun composerSuggestionsFromPayload(value: kotlinx.serialization.json.JsonElement?): List<ComposerSuggestion> {
        val items = value as? JsonArray ?: return emptyList()
        return items.mapNotNull { item ->
            val root = item as? JsonObject ?: return@mapNotNull null
            val type = when ((root["type"] as? JsonPrimitive)?.contentOrNull) {
                "file" -> ComposerCompletionMode.File
                "skill" -> ComposerCompletionMode.Skill
                else -> return@mapNotNull null
            }
            val label = (root["label"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            val insertText = (root["insertText"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            if (label.isBlank() || insertText.isBlank()) return@mapNotNull null
            ComposerSuggestion(
                id = (root["id"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
                    ?: "${type.name}-$label",
                type = type,
                label = label,
                name = (root["name"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() } ?: label,
                detail = (root["detail"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
                insertText = insertText,
                path = (root["path"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            )
        }
    }

    private fun attachmentFromUri(uri: Uri): MessageAttachment? {
        val resolver = getApplication<Application>().contentResolver
        val mimeType = resolver.getType(uri) ?: "image/*"
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return MessageAttachment(
            id = "attachment-${System.currentTimeMillis()}-${UUID.randomUUID()}",
            kind = "image",
            name = displayNameForUri(uri),
            mimeType = mimeType,
            dataUrl = "data:$mimeType;base64,$encoded"
        )
    }

    private fun displayNameForUri(uri: Uri): String {
        val resolver = getApplication<Application>().contentResolver
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) {
                return cursor.getString(index).orEmpty().ifBlank { "image" }
            }
        }
        return uri.lastPathSegment ?: "image"
    }

    override fun onCleared() {
        retryJob?.cancel()
        reconnectJob?.cancel()
        connection?.close()
        repository.close()
        super.onCleared()
    }
}

private data class PendingCommand(
    val id: String,
    val type: String,
    val payload: JsonObject,
    val createdAt: Long
)

private fun defaultModelOptions(): List<ModelOption> {
    return listOf(
        ModelOption("gpt-5.5", "GPT-5.5"),
        ModelOption("gpt-5", "GPT-5"),
        ModelOption("gpt-5-codex", "GPT-5 Codex"),
        ModelOption("o3", "o3")
    )
}
