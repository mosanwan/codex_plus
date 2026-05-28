package app.codep.mobile

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.RadioButtonChecked
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.yield
import kotlin.math.min
import app.codep.mobile.data.Approval
import app.codep.mobile.data.AppLanguage
import app.codep.mobile.data.AppThemeMode
import app.codep.mobile.data.ComposerCompletion
import app.codep.mobile.data.ComposerCompletionMode
import app.codep.mobile.data.ComposerSuggestion
import app.codep.mobile.data.Message
import app.codep.mobile.data.MessageAttachment
import app.codep.mobile.data.MobileTab
import app.codep.mobile.data.ModelOption
import app.codep.mobile.data.RelayConnectionState
import app.codep.mobile.data.RelayDesktopDevice
import app.codep.mobile.data.Session
import app.codep.mobile.data.Workspace

private val Primary: Color
    @Composable get() = LocalCodepPalette.current.primary
private val Ink: Color
    @Composable get() = LocalCodepPalette.current.ink
private val Body: Color
    @Composable get() = LocalCodepPalette.current.body
private val Muted: Color
    @Composable get() = LocalCodepPalette.current.muted
private val Hairline: Color
    @Composable get() = LocalCodepPalette.current.hairline
private val BorderStrong: Color
    @Composable get() = LocalCodepPalette.current.borderStrong
private val Canvas: Color
    @Composable get() = LocalCodepPalette.current.canvas
private val SurfaceSoft: Color
    @Composable get() = LocalCodepPalette.current.surfaceSoft
private val SurfaceStrong: Color
    @Composable get() = LocalCodepPalette.current.surfaceStrong
private val Success: Color
    @Composable get() = LocalCodepPalette.current.success
private val SuccessBorder: Color
    @Composable get() = LocalCodepPalette.current.successBorder
private val SuccessSoft: Color
    @Composable get() = LocalCodepPalette.current.successSoft
private val Danger: Color
    @Composable get() = LocalCodepPalette.current.danger
private val DangerSoft: Color
    @Composable get() = LocalCodepPalette.current.dangerSoft
private val Unread: Color
    @Composable get() = LocalCodepPalette.current.unread
private val Focus: Color
    @Composable get() = LocalCodepPalette.current.focus
private val Mustard: Color
    @Composable get() = LocalCodepPalette.current.mustard
private val Radius = RoundedCornerShape(10.dp)
private val RadiusSmall = RoundedCornerShape(6.dp)
private const val InitialVisibleMessageCount = 40
private const val MessagePageSize = 40
private const val MaxRenderedMessageCount = 160
private const val ChatMessageBufferSize = 240

private enum class SessionViewTab {
    Recent,
    Favorites,
    All
}

private data class SessionListItem(
    val workspace: Workspace,
    val session: Session
)

private data class AppStrings(
    val chat: String,
    val sessions: String,
    val settings: String,
    val connection: String,
    val relayEndpoint: String,
    val apiKey: String,
    val loading: String,
    val refreshDevices: String,
    val connect: String,
    val noDesktopDevices: String,
    val runtime: String,
    val relayMode: String,
    val desktop: String,
    val online: String,
    val notConnected: String,
    val model: String,
    val reasoning: String,
    val permissions: String,
    val clientDevice: String,
    val notifications: String,
    val systemNotifications: String,
    val notificationHelp: String,
    val appearanceLanguage: String,
    val theme: String,
    val dark: String,
    val light: String,
    val language: String,
    val english: String,
    val chinese: String,
    val settingsHeroSubtitle: String,
    val remotePreferences: String,
    val relayConnection: String,
    val desktopConnection: String,
    val runtimeSettings: String,
    val closeRuntimeSettings: String,
    val noMessagesLoaded: String,
    val noMessagesHelp: String,
    val pendingApprovals: String,
    val approve: String,
    val decline: String,
    val open: String,
    val sessionBrowser: String,
    val workspaces: String,
    val recent: String,
    val favorites: String,
    val all: String,
    val newSession: String,
    val removeWorkspace: String,
    val remove: String,
    val cancel: String,
    val save: String,
    val rename: String,
    val renameSession: String,
    val favorite: String,
    val unfavorite: String,
)

private val EnglishStrings = AppStrings(
    chat = "Chat",
    sessions = "Sessions",
    settings = "Settings",
    connection = "Connection",
    relayEndpoint = "Relay endpoint",
    apiKey = "API key",
    loading = "Loading",
    refreshDevices = "Refresh devices",
    connect = "Connect",
    noDesktopDevices = "No online desktop devices for this API key.",
    runtime = "Runtime",
    relayMode = "Relay mode",
    desktop = "Desktop",
    online = "Online",
    notConnected = "Not connected",
    model = "Model",
    reasoning = "Reasoning",
    permissions = "Permissions",
    clientDevice = "Client device",
    notifications = "Notifications",
    systemNotifications = "System notifications",
    notificationHelp = "Notify when a desktop turn completes.",
    appearanceLanguage = "Appearance & language",
    theme = "Theme",
    dark = "Dark",
    light = "Light",
    language = "Language",
    english = "English",
    chinese = "中文",
    settingsHeroSubtitle = "Remote control shell and app preferences",
    remotePreferences = "Remote access and app preferences",
    relayConnection = "Relay connection",
    desktopConnection = "Desktop connection",
    runtimeSettings = "Runtime settings",
    closeRuntimeSettings = "Close runtime settings",
    noMessagesLoaded = "No messages loaded",
    noMessagesHelp = "Open a desktop session or start a workspace from Sessions.",
    pendingApprovals = "Pending approvals",
    approve = "Approve",
    decline = "Decline",
    open = "Open",
    sessionBrowser = "Session browser",
    workspaces = "workspaces",
    recent = "Recent",
    favorites = "Favorites",
    all = "All",
    newSession = "New session",
    removeWorkspace = "Remove workspace",
    remove = "Remove",
    cancel = "Cancel",
    save = "Save",
    rename = "Rename",
    renameSession = "Rename session",
    favorite = "Favorite",
    unfavorite = "Unfavorite",
)

private val ChineseStrings = AppStrings(
    chat = "聊天",
    sessions = "会话",
    settings = "设置",
    connection = "连接",
    relayEndpoint = "Relay 地址",
    apiKey = "API 密钥",
    loading = "加载中",
    refreshDevices = "刷新设备",
    connect = "连接",
    noDesktopDevices = "当前 API key 下没有在线桌面设备。",
    runtime = "运行配置",
    relayMode = "Relay 模式",
    desktop = "桌面端",
    online = "在线",
    notConnected = "未连接",
    model = "模型",
    reasoning = "推理强度",
    permissions = "权限",
    clientDevice = "本机设备",
    notifications = "通知",
    systemNotifications = "系统通知",
    notificationHelp = "桌面端任务完成时发送通知。",
    appearanceLanguage = "外观与语言",
    theme = "主题",
    dark = "深色",
    light = "浅色",
    language = "语言",
    english = "English",
    chinese = "中文",
    settingsHeroSubtitle = "远程控制与应用偏好",
    remotePreferences = "远程访问与应用偏好",
    relayConnection = "Relay 连接",
    desktopConnection = "桌面端连接",
    runtimeSettings = "运行设置",
    closeRuntimeSettings = "关闭运行设置",
    noMessagesLoaded = "还没有消息",
    noMessagesHelp = "打开桌面端会话，或在会话页启动工作区。",
    pendingApprovals = "待审批",
    approve = "批准",
    decline = "拒绝",
    open = "打开",
    sessionBrowser = "会话浏览",
    workspaces = "工作区",
    recent = "最近",
    favorites = "收藏",
    all = "全部",
    newSession = "新建会话",
    removeWorkspace = "移除工作区",
    remove = "移除",
    cancel = "取消",
    save = "保存",
    rename = "重命名",
    renameSession = "重命名会话",
    favorite = "收藏",
    unfavorite = "取消收藏",
)

private val LocalAppStrings = staticCompositionLocalOf { EnglishStrings }

private val S: AppStrings
    @Composable get() = LocalAppStrings.current

private val IsChinese: Boolean
    @Composable get() = LocalAppStrings.current == ChineseStrings

private fun stringsFor(language: AppLanguage): AppStrings {
    return if (language == AppLanguage.Chinese) ChineseStrings else EnglishStrings
}

private data class RuntimeChoice(
    val value: String,
    val label: String,
    val description: String
)

private val EffortOptions = listOf(
    RuntimeChoice("low", "Fast", "Lowest reasoning latency."),
    RuntimeChoice("medium", "Medium", "Balanced speed and depth."),
    RuntimeChoice("high", "High", "Deeper reasoning for harder tasks."),
    RuntimeChoice("xhigh", "XHigh", "Maximum reasoning depth.")
)

private val PermissionOptions = listOf(
    RuntimeChoice(
        "default",
        "Default",
        "Read and edit this workspace, run commands, and ask before internet access or edits outside the workspace."
    ),
    RuntimeChoice(
        "auto-review",
        "Auto-review",
        "Default permissions, with eligible approvals routed through auto-review."
    ),
    RuntimeChoice(
        "full-access",
        "Full Access",
        "Edit outside this workspace and access the internet without asking for approval."
    )
)

@Composable
fun CodepMobileApp(viewModel: MobileViewModel) {
    val state by viewModel.state.collectAsState()
    var runtimeSettingsOpen by remember { mutableStateOf(false) }

    CompositionLocalProvider(LocalAppStrings provides stringsFor(state.language)) {
        Scaffold(
            modifier = Modifier
                .fillMaxSize()
                .background(Canvas)
                .imePadding(),
            topBar = {
                AppHeader(
                    title = when (state.selectedTab) {
                        MobileTab.Chat -> state.activeSession?.title ?: S.chat
                        MobileTab.Sessions -> S.sessions
                        MobileTab.Settings -> S.settings
                    },
                    subtitle = headerSubtitle(state),
                    relayState = state.relayState,
                    desktopOnline = (state.relayPresence?.desktopCount ?: 0) > 0,
                    showRuntimeSettings = state.selectedTab == MobileTab.Chat,
                    onRuntimeSettingsClick = { runtimeSettingsOpen = true }
                )
            },
            bottomBar = {
                BottomTabs(
                    selected = state.selectedTab,
                    hasApprovals = state.approvals.isNotEmpty(),
                    onSelect = viewModel::selectTab
                )
            },
            containerColor = Canvas
        ) { innerPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
            ) {
                when (state.selectedTab) {
                    MobileTab.Chat -> ChatScreen(state, viewModel)
                    MobileTab.Sessions -> SessionsScreen(state, viewModel)
                    MobileTab.Settings -> SettingsScreen(state, viewModel)
                }
            }
        }

        if (runtimeSettingsOpen) {
            RuntimeSettingsDialog(
                state = state,
                onClose = { runtimeSettingsOpen = false },
                onModelChange = viewModel::updateModel,
                onModelEffortChange = viewModel::updateModelEffort,
                onPermissionModeChange = viewModel::updatePermissionMode
            )
        }
        state.filePreviewDialog?.let { dialog ->
            FilePreviewDialogView(
                dialog = dialog,
                onClose = viewModel::closeFilePreview
            )
        }
    }
}

@Composable
private fun FilePreviewDialogView(dialog: FilePreviewDialog, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 620.dp)
                .border(BorderStroke(1.dp, Hairline), Radius)
                .background(Canvas, Radius)
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        text = if (IsChinese) "预览文件" else "Preview file",
                        color = Muted,
                        fontSize = 12.sp,
                        lineHeight = 15.sp
                    )
                    Text(
                        text = dialog.preview?.relativePath ?: dialog.label,
                        color = Ink,
                        fontSize = 16.sp,
                        lineHeight = 21.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
                IconButton(onClick = onClose, modifier = Modifier.size(34.dp)) {
                    Icon(
                        imageVector = Icons.Outlined.Close,
                        contentDescription = if (IsChinese) "关闭文件预览" else "Close file preview",
                        tint = Body,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = dialog.preview?.size?.let(::formatBytes) ?: dialog.workspace,
                    color = Muted,
                    fontSize = 12.sp
                )
                if (dialog.preview?.truncated == true) {
                    Text(
                        text = if (IsChinese) "预览已截断" else "Preview truncated",
                        color = Muted,
                        fontSize = 12.sp
                    )
                }
            }
            when {
                dialog.loading -> PreviewStatusText(if (IsChinese) "正在加载预览..." else "Loading preview...")
                dialog.error != null -> PreviewStatusText(dialog.error)
                else -> Text(
                    text = dialog.preview?.content.orEmpty(),
                    color = Body,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 180.dp, max = 500.dp)
                        .border(BorderStroke(1.dp, Hairline), RadiusSmall)
                        .background(SurfaceSoft, RadiusSmall)
                        .verticalScroll(rememberScrollState())
                        .horizontalScroll(rememberScrollState())
                        .padding(10.dp),
                    softWrap = false
                )
            }
        }
    }
}

@Composable
private fun PreviewStatusText(text: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 180.dp)
            .border(BorderStroke(1.dp, Hairline), RadiusSmall)
            .background(SurfaceSoft, RadiusSmall)
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text = text, color = Muted, fontSize = 13.sp, lineHeight = 18.sp)
    }
}

@Composable
private fun AppHeader(
    title: String,
    subtitle: String,
    relayState: RelayConnectionState,
    desktopOnline: Boolean,
    showRuntimeSettings: Boolean,
    onRuntimeSettingsClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .background(Canvas)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(64.dp)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = title,
                    color = Ink,
                    fontSize = 21.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (subtitle.isNotBlank()) {
                    Text(
                        text = subtitle,
                        color = Muted,
                        fontSize = 11.sp,
                        lineHeight = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                HeaderStatusIcon(
                    icon = Icons.Outlined.Wifi,
                    active = relayState == RelayConnectionState.Connected,
                    contentDescription = S.relayConnection
                )
                HeaderStatusIcon(
                    icon = Icons.Outlined.DesktopWindows,
                    active = desktopOnline,
                    contentDescription = S.desktopConnection
                )
                if (showRuntimeSettings) {
                    HeaderIconButton(
                    icon = Icons.Outlined.Settings,
                        contentDescription = S.runtimeSettings,
                        onClick = onRuntimeSettingsClick
                    )
                }
            }
        }
        HorizontalDivider(color = Hairline)
    }
}

@Composable
private fun HeaderStatusIcon(
    icon: ImageVector,
    active: Boolean,
    contentDescription: String
) {
    Box(
        modifier = Modifier
            .size(24.dp)
            .clip(RadiusSmall),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = if (active) Success else Muted,
            modifier = Modifier.size(16.dp)
        )
    }
}

@Composable
private fun HeaderIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(38.dp)
            .border(BorderStroke(1.dp, Hairline), RadiusSmall)
            .background(Canvas, RadiusSmall)
            .clip(RadiusSmall)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = Body,
            modifier = Modifier.size(18.dp)
        )
    }
}

@Composable
private fun StatusDot(active: Boolean) {
    Box(
        modifier = Modifier
            .size(11.dp)
            .clip(CircleShape)
            .background(if (active) Success else Hairline)
    )
}

@Composable
private fun BottomTabs(
    selected: MobileTab,
    hasApprovals: Boolean,
    onSelect: (MobileTab) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Canvas)
            .navigationBarsPadding()
    ) {
        HorizontalDivider(color = Hairline)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            TabButton(S.chat, Icons.Outlined.ChatBubbleOutline, selected == MobileTab.Chat) {
                onSelect(MobileTab.Chat)
            }
            TabButton(
                if (hasApprovals) "${S.sessions} !" else S.sessions,
                Icons.AutoMirrored.Outlined.ListAlt,
                selected == MobileTab.Sessions
            ) {
                onSelect(MobileTab.Sessions)
            }
            TabButton(S.settings, Icons.Outlined.Settings, selected == MobileTab.Settings) {
                onSelect(MobileTab.Settings)
            }
        }
    }
}

@Composable
private fun RowScope.TabButton(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .weight(1f)
            .height(58.dp)
            .clip(RadiusSmall)
            .background(if (selected) SurfaceSoft else Color.Transparent)
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (selected) Ink else Muted,
                modifier = Modifier.size(20.dp)
            )
            if (label.contains("!")) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .align(Alignment.TopEnd)
                        .clip(CircleShape)
                        .background(Unread)
                )
            }
        }
        Text(
            label.replace(" !", ""),
            color = if (selected) Ink else Muted,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun ChatScreen(state: MobileUiState, viewModel: MobileViewModel) {
    val listState = rememberLazyListState()
    val displayMessages = remember(state.messages) {
        state.messages
            .asReversed()
            .asSequence()
            .filterNot(::isHiddenChatMessage)
            .take(ChatMessageBufferSize)
            .toList()
            .asReversed()
    }
    var visibleMessageCount by remember(state.activeSessionId) { mutableStateOf(InitialVisibleMessageCount) }
    var pendingHistoryOffset by remember { mutableStateOf(0) }
    var pendingHistoryAnchor by remember { mutableStateOf(0) }
    var pendingHistoryAnchorOffset by remember { mutableStateOf(0) }
    val visibleLimit = min(displayMessages.size, MaxRenderedMessageCount)
    val effectiveVisibleCount = min(visibleMessageCount, visibleLimit)
    val hiddenMessageCount = (displayMessages.size - effectiveVisibleCount).coerceAtLeast(0)
    val loadableHiddenCount = (visibleLimit - effectiveVisibleCount).coerceAtLeast(0)
    val visibleMessages = remember(displayMessages, hiddenMessageCount) {
        displayMessages.drop(hiddenMessageCount)
    }
    val latestMessageRenderKey = displayMessages.lastOrNull()?.let { message ->
        "${message.id}:${message.text.length}:${message.attachments.size}:${state.isWorking}"
    }.orEmpty()

    LaunchedEffect(state.activeSessionId, latestMessageRenderKey, state.diffLines.sumOf { it.length }) {
        if (pendingHistoryOffset == 0) {
            val itemCount =
                (if (hiddenMessageCount > 0) 1 else 0) +
                    (if (displayMessages.isEmpty()) 1 else 0) +
                    visibleMessages.size +
                    (if (state.diffLines.isNotEmpty()) 1 else 0)
            scrollChatToBottom(listState, itemCount)
        }
    }

    LaunchedEffect(visibleMessageCount) {
        if (pendingHistoryOffset > 0) {
            yield()
            listState.scrollToItem(
                (pendingHistoryAnchor + pendingHistoryOffset).coerceAtLeast(0),
                pendingHistoryAnchorOffset
            )
            pendingHistoryOffset = 0
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        if (state.approvals.isNotEmpty()) {
            ApprovalStrip(approvals = state.approvals, viewModel = viewModel)
        }
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(SurfaceSoft),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 16.dp,
                top = 16.dp,
                end = 16.dp,
                bottom = 14.dp
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (hiddenMessageCount > 0) {
                item(key = "history-loader") {
                    HistoryLoader(
                        hiddenCount = hiddenMessageCount,
                        loadableCount = loadableHiddenCount,
                        onLoadOlder = {
                            val addCount = min(MessagePageSize, loadableHiddenCount)
                            if (addCount <= 0) return@HistoryLoader
                            pendingHistoryAnchor = listState.firstVisibleItemIndex
                            pendingHistoryAnchorOffset = listState.firstVisibleItemScrollOffset
                            pendingHistoryOffset = addCount
                            visibleMessageCount = min(visibleMessageCount + addCount, visibleLimit)
                        }
                    )
                }
            }
            if (displayMessages.isEmpty()) {
                item {
                    EmptyState(
                        title = S.noMessagesLoaded,
                        body = state.status.ifBlank { S.noMessagesHelp }
                    )
                }
            }
            items(visibleMessages, key = { it.id }) { message ->
                MessageBubble(
                    message = message,
                    onPreviewFile = viewModel::requestFilePreview
                )
            }
            if (state.diffLines.isNotEmpty()) {
                item(key = "diff-preview") {
                    DiffPreview(lines = state.diffLines.take(80))
                }
            }
        }
        Composer(
            value = state.composer,
            completion = state.composerCompletion,
            pendingAttachments = state.pendingAttachments,
            working = state.isWorking,
            connected = state.relayState == RelayConnectionState.Connected,
            sessionReady = state.activeSession != null,
            onChange = viewModel::updateComposer,
            onAddImages = viewModel::addImageAttachments,
            onRemoveAttachment = viewModel::removePendingAttachment,
            onInsertTrigger = viewModel::insertComposerTrigger,
            onSelectSuggestion = viewModel::selectComposerSuggestion,
            onSend = viewModel::sendMessage,
            onInterrupt = viewModel::interruptTurn
        )
    }
}

@Composable
private fun HistoryLoader(hiddenCount: Int, loadableCount: Int, onLoadOlder: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center
    ) {
        if (loadableCount > 0) {
            OutlinedButton(
                onClick = onLoadOlder,
                border = BorderStroke(1.dp, Hairline),
                shape = RadiusSmall
            ) {
                Text(
                    text = "Load ${min(MessagePageSize, loadableCount)} older",
                    color = Ink,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
        }
        val label = if (loadableCount > 0) {
            "$hiddenCount hidden"
        } else {
            "Latest $MaxRenderedMessageCount shown"
        }
        Text(label, color = Muted, fontSize = 12.sp)
    }
}

@Composable
private fun ApprovalStrip(approvals: List<Approval>, viewModel: MobileViewModel) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Canvas)
            .border(BorderStroke(1.dp, Hairline))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(S.pendingApprovals, color = Ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
        approvals.forEach { approval ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .border(BorderStroke(1.dp, Danger), Radius)
                    .background(DangerSoft, Radius)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(approval.title, color = Ink, fontWeight = FontWeight.Medium)
                Text(approval.detail, color = Body, fontSize = 13.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { viewModel.resolveApproval(approval.id, "accept") },
                        colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = Canvas),
                        shape = RadiusSmall
                    ) {
                        Text(S.approve)
                    }
                    OutlinedButton(
                        onClick = { viewModel.resolveApproval(approval.id, "decline") },
                        border = BorderStroke(1.dp, Hairline),
                        shape = RadiusSmall
                    ) {
                        Text(S.decline, color = Ink)
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: Message, onPreviewFile: (String, String) -> Unit) {
    val isUser = message.role == "user"
    val isEvent = message.role == "event"
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth(0.88f)
                .border(
                    BorderStroke(1.dp, if (isUser) Primary else Color.Transparent),
                    Radius
                )
                .background(
                    if (isUser) Primary else Color.Transparent,
                    Radius
                )
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            val meta = message.meta.ifBlank { if (isEvent) "event" else "" }
            if (!isUser && meta.isNotBlank()) {
                Text(
                    text = meta,
                    color = Muted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium
                )
            }
            MarkdownContent(
                text = message.text.ifBlank { "(attachment)" },
                userMessage = isUser,
                eventMessage = isEvent,
                onPreviewFile = onPreviewFile
            )
            if (message.attachments.isNotEmpty()) {
                MessageAttachmentList(
                    attachments = message.attachments,
                    userMessage = isUser
                )
            }
        }
    }
}

@Composable
private fun MessageAttachmentList(attachments: List<MessageAttachment>, userMessage: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        attachments.forEach { attachment ->
            Text(
                text = attachment.name.ifBlank { "attachment" },
                color = if (userMessage) Canvas.copy(alpha = 0.76f) else Muted,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun MarkdownContent(
    text: String,
    userMessage: Boolean,
    eventMessage: Boolean,
    onPreviewFile: (String, String) -> Unit
) {
    val blocks = remember(text) { parseMarkdownBlocks(text) }
    val textColor = if (userMessage) Canvas else Body
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MarkdownBlock.Heading -> InlineMarkdownText(
                    text = block.text,
                    textColor = textColor,
                    fontSize = (when (block.level) {
                        1 -> 17
                        2 -> 16
                        else -> 15
                    }).sp,
                    lineHeight = 21.sp,
                    fontWeight = FontWeight.Medium,
                    onPreviewFile = onPreviewFile
                )

                is MarkdownBlock.Paragraph -> InlineMarkdownText(
                    text = block.text,
                    textColor = textColor,
                    fontSize = if (eventMessage) 12.sp else 14.sp,
                    lineHeight = if (eventMessage) 17.sp else 20.sp,
                    fontFamily = if (eventMessage) FontFamily.Monospace else FontFamily.Default,
                    onPreviewFile = onPreviewFile
                )

                is MarkdownBlock.ListItems -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    block.items.forEachIndexed { index, item ->
                        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            Text(
                                text = if (block.ordered) "${index + 1}." else "-",
                                color = if (userMessage) Canvas.copy(alpha = 0.76f) else Muted,
                                fontSize = 14.sp,
                                lineHeight = 20.sp,
                                fontFamily = if (eventMessage) FontFamily.Monospace else FontFamily.Default
                            )
                            InlineMarkdownText(
                                text = item,
                                textColor = textColor,
                                fontSize = if (eventMessage) 12.sp else 14.sp,
                                lineHeight = if (eventMessage) 17.sp else 20.sp,
                                modifier = Modifier.weight(1f),
                                fontFamily = if (eventMessage) FontFamily.Monospace else FontFamily.Default,
                                onPreviewFile = onPreviewFile
                            )
                        }
                    }
                }

                is MarkdownBlock.Code -> CodeBlock(text = block.code, language = block.language, userMessage = userMessage)
                is MarkdownBlock.Quote -> QuoteBlock(
                    text = block.text,
                    userMessage = userMessage,
                    onPreviewFile = onPreviewFile
                )
            }
        }
    }
}

@Composable
private fun CodeBlock(text: String, language: String, userMessage: Boolean) {
    val isDiff = language.equals("diff", ignoreCase = true) || text.lines().any {
        it.startsWith("diff --git") || it.startsWith("@@")
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, if (userMessage) Canvas.copy(alpha = 0.22f) else Hairline), RadiusSmall)
            .background(if (userMessage) Primary.copy(alpha = 0.72f) else Canvas, RadiusSmall)
            .horizontalScroll(rememberScrollState())
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(1.dp)
    ) {
        text.lines().forEach { line ->
            Text(
                text = line.ifBlank { " " },
                color = if (isDiff) diffLineColor(line) else if (userMessage) Canvas else Body,
                fontSize = 12.sp,
                lineHeight = 17.sp,
                fontFamily = FontFamily.Monospace,
                softWrap = false
            )
        }
    }
}

@Composable
private fun InlineMarkdownText(
    text: String,
    textColor: Color,
    fontSize: TextUnit,
    lineHeight: TextUnit,
    modifier: Modifier = Modifier,
    fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null,
    onPreviewFile: (String, String) -> Unit
) {
    val previewLink = remember(text) { previewLinkFromMarkdown(text) }
    Text(
        text = inlineMarkdown(previewLink?.displayText ?: text, if (previewLink != null) Focus else textColor),
        color = if (previewLink != null) Focus else textColor,
        fontSize = fontSize,
        lineHeight = lineHeight,
        fontWeight = fontWeight,
        fontFamily = fontFamily,
        textDecoration = if (previewLink != null) TextDecoration.Underline else null,
        modifier = if (previewLink != null) {
            modifier.clickable { onPreviewFile(previewLink.path, previewLink.label) }
        } else {
            modifier
        }
    )
}

@Composable
private fun QuoteBlock(
    text: String,
    userMessage: Boolean,
    onPreviewFile: (String, String) -> Unit
) {
    InlineMarkdownText(
        text = text,
        textColor = if (userMessage) Canvas.copy(alpha = 0.8f) else Muted,
        fontSize = 13.sp,
        lineHeight = 19.sp,
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, if (userMessage) Canvas.copy(alpha = 0.2f) else Hairline), RadiusSmall)
            .background(if (userMessage) Primary.copy(alpha = 0.62f) else Canvas, RadiusSmall)
            .padding(8.dp),
        onPreviewFile = onPreviewFile
    )
}

private sealed class MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock()
    data class Paragraph(val text: String) : MarkdownBlock()
    data class ListItems(val ordered: Boolean, val items: List<String>) : MarkdownBlock()
    data class Code(val language: String, val code: String) : MarkdownBlock()
    data class Quote(val text: String) : MarkdownBlock()
}

private fun parseMarkdownBlocks(text: String): List<MarkdownBlock> {
    val lines = text.replace("\r\n", "\n").lines()
    val blocks = mutableListOf<MarkdownBlock>()
    var index = 0
    while (index < lines.size) {
        val line = lines[index]
        if (line.isBlank()) {
            index += 1
            continue
        }
        if (line.trimStart().startsWith("```")) {
            val fence = line.trimStart()
            val language = fence.removePrefix("```").trim()
            val codeLines = mutableListOf<String>()
            index += 1
            while (index < lines.size && !lines[index].trimStart().startsWith("```")) {
                codeLines += lines[index]
                index += 1
            }
            if (index < lines.size) index += 1
            blocks += MarkdownBlock.Code(language = language, code = codeLines.joinToString("\n"))
            continue
        }
        val heading = Regex("""^(#{1,6})\s+(.+)$""").find(line)
        if (heading != null) {
            blocks += MarkdownBlock.Heading(
                level = heading.groupValues[1].length,
                text = heading.groupValues[2].trim()
            )
            index += 1
            continue
        }
        if (line.trimStart().startsWith(">")) {
            val quoteLines = mutableListOf<String>()
            while (index < lines.size && lines[index].trimStart().startsWith(">")) {
                quoteLines += lines[index].trimStart().removePrefix(">").trimStart()
                index += 1
            }
            blocks += MarkdownBlock.Quote(quoteLines.joinToString("\n"))
            continue
        }
        val unordered = Regex("""^\s*[-*]\s+(.+)$""")
        val ordered = Regex("""^\s*\d+\.\s+(.+)$""")
        val unorderedMatch = unordered.find(line)
        val orderedMatch = ordered.find(line)
        if (unorderedMatch != null || orderedMatch != null) {
            val isOrdered = orderedMatch != null
            val matcher = if (isOrdered) ordered else unordered
            val items = mutableListOf<String>()
            while (index < lines.size) {
                val match = matcher.find(lines[index]) ?: break
                items += match.groupValues[1].trim()
                index += 1
            }
            blocks += MarkdownBlock.ListItems(isOrdered, items)
            continue
        }
        val paragraphLines = mutableListOf(line.trim())
        index += 1
        while (index < lines.size && lines[index].isNotBlank() && !startsMarkdownBlock(lines[index])) {
            paragraphLines += lines[index].trim()
            index += 1
        }
        blocks += MarkdownBlock.Paragraph(paragraphLines.joinToString(" "))
    }
    return blocks.ifEmpty { listOf(MarkdownBlock.Paragraph(text)) }
}

private fun startsMarkdownBlock(line: String): Boolean {
    val trimmed = line.trimStart()
    return trimmed.startsWith("```") ||
        Regex("""^#{1,6}\s+""").containsMatchIn(trimmed) ||
        trimmed.startsWith(">") ||
        Regex("""^[-*]\s+""").containsMatchIn(trimmed) ||
        Regex("""^\d+\.\s+""").containsMatchIn(trimmed)
}

@Composable
private fun inlineMarkdown(text: String, textColor: Color): AnnotatedString {
    return buildAnnotatedString {
        var index = 0
        val inlineRegex = Regex("""(`[^`]+`|\*\*[^*]+\*\*)""")
        inlineRegex.findAll(text).forEach { match ->
            if (match.range.first > index) {
                append(text.substring(index, match.range.first))
            }
            val token = match.value
            if (token.startsWith("`")) {
                withStyle(
                    SpanStyle(
                        color = textColor,
                        background = if (textColor == Canvas) Canvas.copy(alpha = 0.12f) else SurfaceStrong,
                        fontFamily = FontFamily.Monospace
                    )
                ) {
                    append(token.removePrefix("`").removeSuffix("`"))
                }
            } else {
                withStyle(SpanStyle(color = textColor, fontWeight = FontWeight.Bold)) {
                    append(token.removePrefix("**").removeSuffix("**"))
                }
            }
            index = match.range.last + 1
        }
        if (index < text.length) {
            append(text.substring(index))
        }
    }
}

private data class PreviewLink(val label: String, val path: String, val displayText: String)

private fun previewLinkFromMarkdown(text: String): PreviewLink? {
    val match = Regex("""\[([^\]]+)]\(([^)]+)\)""").find(text) ?: return null
    val label = match.groupValues[1].trim()
    val path = normalizePreviewHref(match.groupValues[2])
    if (label.isBlank() || path.isBlank()) return null
    return PreviewLink(label = label, path = path, displayText = text.replace(match.value, label))
}

private fun normalizePreviewHref(value: String): String {
    val trimmed = value.substringBefore('#').substringBefore('?').trim()
    if (trimmed.startsWith("file://", ignoreCase = true)) {
        return runCatching { java.net.URI(trimmed).path.orEmpty() }.getOrDefault("")
    }
    if (Regex("""^[a-z][a-z0-9+.-]*:""", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) {
        return ""
    }
    return runCatching { java.net.URLDecoder.decode(trimmed, Charsets.UTF_8.name()) }
        .getOrDefault(trimmed)
        .trim()
}

private fun formatBytes(value: Long): String {
    return when {
        value < 1024L -> "$value B"
        value < 1024L * 1024L -> "${"%.1f".format(value / 1024.0)} KB"
        else -> "${"%.1f".format(value / (1024.0 * 1024.0))} MB"
    }
}

@Composable
private fun diffLineColor(line: String): Color {
    return when {
        line.startsWith("+") && !line.startsWith("+++") -> Success
        line.startsWith("-") && !line.startsWith("---") -> Danger
        line.startsWith("@@") -> Focus
        line.startsWith("diff --git") ||
            line.startsWith("index ") ||
            line.startsWith("---") ||
            line.startsWith("+++") -> Muted
        else -> Body
    }
}

@Composable
private fun DiffPreview(lines: List<String>) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, Hairline), Radius)
            .background(Canvas, Radius)
            .padding(13.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        Text("Diff preview", color = Ink, fontWeight = FontWeight.Medium)
        lines.forEach { line ->
            Text(
                text = line,
                color = when {
                    line.startsWith("+") -> Success
                    line.startsWith("-") -> Danger
                    else -> Body
                },
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun Composer(
    value: String,
    completion: ComposerCompletion?,
    pendingAttachments: List<MessageAttachment>,
    working: Boolean,
    connected: Boolean,
    sessionReady: Boolean,
    onChange: (String) -> Unit,
    onAddImages: (List<Uri>) -> Unit,
    onRemoveAttachment: (String) -> Unit,
    onInsertTrigger: (String) -> Unit,
    onSelectSuggestion: (String) -> Unit,
    onSend: () -> Unit,
    onInterrupt: () -> Unit
) {
    val focusRequester = remember { FocusRequester() }
    val attachmentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetMultipleContents(),
        onResult = onAddImages
    )
    val composerEnabled = connected && sessionReady
    val canSend = composerEnabled && (value.trim().isNotBlank() || pendingAttachments.isNotEmpty())

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Canvas)
            .border(BorderStroke(1.dp, Hairline))
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        if (working || !sessionReady) {
            if (working) {
                WorkingTurnStatus()
            } else {
                IdleComposerStatus()
            }
        }
        if (completion != null) {
            ComposerCompletionMenu(
                completion = completion,
                onSelect = onSelectSuggestion
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .border(BorderStroke(1.dp, BorderStrong), RoundedCornerShape(12.dp))
                .background(Canvas, RoundedCornerShape(12.dp))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            if (pendingAttachments.isNotEmpty()) {
                PendingAttachmentStrip(
                    attachments = pendingAttachments,
                    onRemove = onRemoveAttachment
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onChange,
                enabled = composerEnabled,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 32.dp, max = 92.dp)
                    .focusRequester(focusRequester),
                textStyle = TextStyle(
                    color = Ink,
                    fontSize = 15.sp,
                    lineHeight = 20.sp
                ),
                cursorBrush = SolidColor(Focus),
                decorationBox = { innerTextField ->
                    Box(
                        modifier = Modifier.fillMaxWidth(),
                        contentAlignment = Alignment.TopStart
                    ) {
                        if (value.isBlank()) {
                            Text(
                                text = "Message Codex on your desktop",
                                color = Muted,
                                fontSize = 15.sp,
                                lineHeight = 20.sp
                            )
                        }
                        innerTextField()
                    }
                }
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                ComposerIconTool(
                    icon = Icons.Outlined.Add,
                    label = "Add images",
                    enabled = composerEnabled,
                    onClick = { attachmentLauncher.launch("image/*") }
                )
                Box(
                    modifier = Modifier
                        .width(1.dp)
                        .height(18.dp)
                        .background(Hairline)
                )
                ComposerTokenTool(
                    marker = "@",
                    label = "Files",
                    enabled = composerEnabled,
                    onClick = {
                        onInsertTrigger("@")
                        focusRequester.requestFocus()
                    }
                )
                ComposerTokenTool(
                    marker = "$",
                    label = "Skills",
                    enabled = composerEnabled,
                    onClick = {
                        onInsertTrigger("$")
                        focusRequester.requestFocus()
                    }
                )
                Spacer(modifier = Modifier.weight(1f))
                if (working && value.trim().isBlank() && pendingAttachments.isEmpty()) {
                    SendStopButton(
                        stop = true,
                        enabled = true,
                        onClick = onInterrupt
                    )
                } else {
                    SendStopButton(
                        stop = false,
                        enabled = canSend,
                        onClick = onSend
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkingTurnStatus() {
    val transition = rememberInfiniteTransition(label = "working-turn")
    val pulseScale by transition.animateFloat(
        initialValue = 0.78f,
        targetValue = 1.28f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200),
            repeatMode = RepeatMode.Reverse
        ),
        label = "working-pulse-scale"
    )
    val pulseAlpha by transition.animateFloat(
        initialValue = 0.1f,
        targetValue = 0.28f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200),
            repeatMode = RepeatMode.Reverse
        ),
        label = "working-pulse-alpha"
    )
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(modifier = Modifier.size(16.dp), contentAlignment = Alignment.Center) {
            Box(
                modifier = Modifier
                    .size(14.dp)
                    .graphicsLayer {
                        scaleX = pulseScale
                        scaleY = pulseScale
                        alpha = pulseAlpha
                    }
                    .clip(CircleShape)
                    .background(Success)
            )
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(Success)
            )
        }
        Text(
            text = "Working",
            color = Body,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold
        )
        WorkingActivityDots()
        Spacer(modifier = Modifier.weight(1f))
        Text(
            text = "turn",
            color = Muted,
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
            maxLines = 1
        )
    }
}

@Composable
private fun WorkingActivityDots() {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        WorkingActivityDot(color = Focus, delayMillis = 0)
        WorkingActivityDot(color = Mustard, delayMillis = 160)
        WorkingActivityDot(color = Success, delayMillis = 320)
    }
}

@Composable
private fun WorkingActivityDot(color: Color, delayMillis: Int) {
    val transition = rememberInfiniteTransition(label = "working-dot-$delayMillis")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 620, delayMillis = delayMillis),
            repeatMode = RepeatMode.Reverse
        ),
        label = "working-dot-alpha-$delayMillis"
    )
    Box(
        modifier = Modifier
            .size(5.dp)
            .graphicsLayer { this.alpha = alpha }
            .clip(CircleShape)
            .background(color)
    )
}

@Composable
private fun IdleComposerStatus() {
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(Muted)
        )
        Text(
            text = "Open a session to start chatting",
            color = Muted,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun ComposerCompletionMenu(
    completion: ComposerCompletion,
    onSelect: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, Hairline), Radius)
            .background(Canvas, Radius)
            .padding(6.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        if (completion.items.isEmpty()) {
            Text(
                text = if (completion.loading) "Loading..." else if (completion.mode == ComposerCompletionMode.File) "No matching files" else "No matching skills",
                color = Muted,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 7.dp)
            )
        } else {
            completion.items.take(6).forEach { item ->
                ComposerCompletionItem(item = item, onSelect = onSelect)
            }
        }
    }
}

@Composable
private fun ComposerCompletionItem(
    item: ComposerSuggestion,
    onSelect: (String) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RadiusSmall)
            .clickable { onSelect(item.id) }
            .padding(horizontal = 8.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .border(BorderStroke(1.dp, Hairline), RadiusSmall)
                .background(SurfaceSoft, RadiusSmall),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = if (item.type == ComposerCompletionMode.File) "@" else "$",
                color = Muted,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace
            )
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = item.label,
                color = Body,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (item.detail.isNotBlank()) {
                Text(
                    text = item.detail,
                    color = Muted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun PendingAttachmentStrip(
    attachments: List<MessageAttachment>,
    onRemove: (String) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        attachments.forEach { attachment ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .border(BorderStroke(1.dp, Hairline), RadiusSmall)
                    .background(SurfaceSoft, RadiusSmall)
                    .padding(start = 8.dp, top = 5.dp, end = 4.dp, bottom = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.FolderOpen,
                    contentDescription = null,
                    tint = Muted,
                    modifier = Modifier.size(15.dp)
                )
                Text(
                    text = attachment.name.ifBlank { "image" },
                    color = Body,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                IconButton(
                    onClick = { onRemove(attachment.id) },
                    modifier = Modifier.size(26.dp)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Close,
                        contentDescription = "Remove attachment",
                        tint = Muted,
                        modifier = Modifier.size(15.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun ComposerIconTool(
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(28.dp)
            .clip(RadiusSmall)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = if (enabled) Muted else Muted.copy(alpha = 0.45f),
            modifier = Modifier.size(17.dp)
        )
    }
}

@Composable
private fun ComposerTokenTool(
    marker: String,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .height(28.dp)
            .clip(RadiusSmall)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        Text(
            text = marker,
            color = if (enabled) Muted else Muted.copy(alpha = 0.45f),
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            maxLines = 1
        )
        Text(
            text = label,
            color = if (enabled) Muted else Muted.copy(alpha = 0.45f),
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1
        )
    }
}

@Composable
private fun SendStopButton(
    stop: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (stop) DangerSoft else Primary,
            contentColor = if (stop) Danger else Canvas,
            disabledContainerColor = SurfaceStrong,
            disabledContentColor = Muted
        ),
        shape = Radius,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
        modifier = Modifier
            .width(44.dp)
            .height(32.dp)
    ) {
        Icon(
            imageVector = if (stop) Icons.Outlined.Stop else Icons.Outlined.ArrowUpward,
            contentDescription = if (stop) "Stop current turn" else "Send message",
            modifier = Modifier.size(if (stop) 16.dp else 18.dp)
        )
    }
}

@Composable
private fun SessionsScreen(state: MobileUiState, viewModel: MobileViewModel) {
    var selectedView by remember { mutableStateOf(SessionViewTab.Recent) }
    var collapsedWorkspaces by remember { mutableStateOf<Set<String>>(emptySet()) }
    val workspaceSessions = remember(state.workspaces) {
        state.workspaces.flatMap { workspace ->
            workspace.sessions.map { session -> SessionListItem(workspace, session) }
        }
    }
    val recentSessions = remember(workspaceSessions) {
        workspaceSessions.sortedWith(
            compareByDescending<SessionListItem> { it.session.status == "working" }
                .thenByDescending { it.session.unread }
                .thenByDescending { it.session.updatedAt }
                .thenBy { it.session.title.lowercase() }
        )
    }
    val favoriteSessions = remember(workspaceSessions) {
        workspaceSessions.filter { it.session.favorite }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(SurfaceSoft),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 12.dp,
            top = 12.dp,
            end = 12.dp,
            bottom = 14.dp
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            WorkspacePathBox(state = state, viewModel = viewModel)
        }
        item {
            SessionsHeader(
                selected = selectedView,
                workspaceCount = state.workspaces.size,
                sessionCount = workspaceSessions.size,
                favoriteCount = favoriteSessions.size,
                onSelect = { selectedView = it }
            )
        }
        when (selectedView) {
            SessionViewTab.Recent -> {
                if (recentSessions.isEmpty()) {
                    item {
                        EmptyState(
                            title = if (IsChinese) "没有最近会话" else "No recent sessions",
                            body = if (IsChinese) "工作区历史加载后会显示在这里。" else "Recent sessions appear here after workspace history loads."
                        )
                    }
                } else {
                    items(recentSessions, key = { "${it.workspace.path}:${it.session.id}" }) { item ->
                        SessionRow(
                            session = item.session,
                            meta = "${item.workspace.name} · ${item.session.updatedAt}".trim(' ', '·'),
                            active = item.session.id == state.activeSessionId,
                            favorite = item.session.favorite,
                            onOpen = { viewModel.openSession(item.session.id) },
                            onToggleFavorite = { viewModel.toggleSessionFavorite(item.session.id) },
                            onRename = { title -> viewModel.renameSession(item.workspace.path, item.session.id, title) },
                            onRemove = { viewModel.removeSession(item.workspace.path, item.session.id) }
                        )
                    }
                }
            }

            SessionViewTab.Favorites -> {
                if (favoriteSessions.isEmpty()) {
                    item {
                        EmptyState(
                            title = if (IsChinese) "还没有收藏" else "No favorites yet",
                            body = if (IsChinese) "收藏常用会话后会显示在这里。" else "Star sessions to keep them close."
                        )
                    }
                } else {
                    items(favoriteSessions, key = { "${it.workspace.path}:${it.session.id}" }) { item ->
                        SessionRow(
                            session = item.session,
                            meta = "${item.workspace.name} · ${item.session.updatedAt}".trim(' ', '·'),
                            active = item.session.id == state.activeSessionId,
                            favorite = true,
                            onOpen = { viewModel.openSession(item.session.id) },
                            onToggleFavorite = { viewModel.toggleSessionFavorite(item.session.id) },
                            onRename = { title -> viewModel.renameSession(item.workspace.path, item.session.id, title) },
                            onRemove = { viewModel.removeSession(item.workspace.path, item.session.id) }
                        )
                    }
                }
            }

            SessionViewTab.All -> {
                if (state.workspaces.isEmpty()) {
                    item {
                        EmptyState(
                            title = if (IsChinese) "没有工作区" else "No workspaces",
                            body = if (IsChinese) "连接桌面端后会加载工作区和会话。" else "Connect the desktop app to load workspaces and sessions."
                        )
                    }
                } else {
                    items(state.workspaces, key = { it.path }) { workspace ->
                        val collapsed = collapsedWorkspaces.contains(workspace.path)
                        WorkspaceBlock(
                            workspace = workspace,
                            active = workspace.path == state.activeWorkspace,
                            collapsed = collapsed,
                            activeSessionId = state.activeSessionId,
                            onToggleCollapsed = {
                                collapsedWorkspaces = if (collapsed) {
                                    collapsedWorkspaces - workspace.path
                                } else {
                                    collapsedWorkspaces + workspace.path
                                }
                            },
                            onOpenWorkspace = { viewModel.openWorkspace(workspace.path) },
                            onStartSession = { viewModel.startSession(workspace.path) },
                            onRemoveWorkspace = { viewModel.removeWorkspace(workspace.path) },
                            onOpenSession = viewModel::openSession,
                            onToggleFavorite = viewModel::toggleSessionFavorite,
                            onRenameSession = viewModel::renameSession,
                            onRemoveSession = viewModel::removeSession
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RuntimeSettingsDialog(
    state: MobileUiState,
    onClose: () -> Unit,
    onModelChange: (String) -> Unit,
    onModelEffortChange: (String) -> Unit,
    onPermissionModeChange: (String) -> Unit
) {
    val modelOptions = runtimeModelOptions(state.model, state.modelOptions)
    Dialog(onDismissRequest = onClose) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .border(BorderStroke(1.dp, Hairline), RoundedCornerShape(12.dp))
                .background(Canvas, RoundedCornerShape(12.dp))
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(13.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                SettingsIconBox(Icons.Outlined.Tune)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(S.runtimeSettings, color = Ink, fontSize = 18.sp, fontWeight = FontWeight.Medium)
                    Text(
                        text = "${state.model} · ${effortLabel(state.modelEffort)} · ${permissionLabel(state.permissionMode)}",
                        color = Muted,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                IconButton(onClick = onClose, modifier = Modifier.size(34.dp)) {
                    Icon(
                        imageVector = Icons.Outlined.Close,
                        contentDescription = S.closeRuntimeSettings,
                        tint = Muted,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            RuntimeOptionSection(title = S.model) {
                modelOptions.forEach { option ->
                    RuntimeOptionRow(
                        label = option.label,
                        detail = option.id,
                        selected = option.id == state.model,
                        onClick = { onModelChange(option.id) }
                    )
                }
            }

            RuntimeOptionSection(title = S.reasoning) {
                EffortOptions.forEach { option ->
                    RuntimeOptionRow(
                        label = option.label,
                        detail = option.description,
                        selected = option.value == state.modelEffort,
                        onClick = { onModelEffortChange(option.value) }
                    )
                }
            }

            RuntimeOptionSection(title = S.permissions) {
                PermissionOptions.forEach { option ->
                    RuntimeOptionRow(
                        label = option.label,
                        detail = option.description,
                        selected = option.value == state.permissionMode,
                        onClick = { onPermissionModeChange(option.value) }
                    )
                }
            }
        }
    }
}

@Composable
private fun RuntimeOptionSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, Hairline), Radius)
            .background(SurfaceSoft, Radius)
            .padding(9.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = title,
            color = Muted,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium
        )
        content()
    }
}

@Composable
private fun RuntimeOptionRow(
    label: String,
    detail: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RadiusSmall)
            .background(if (selected) SurfaceStrong else Color.Transparent, RadiusSmall)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        RadioButton(
            selected = selected,
            onClick = onClick,
            colors = RadioButtonDefaults.colors(selectedColor = Ink, unselectedColor = Muted)
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = label,
                color = Ink,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (detail.isNotBlank() && detail != label) {
                Text(
                    text = detail,
                    color = Muted,
                    fontSize = 11.sp,
                    lineHeight = 14.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

private fun runtimeModelOptions(currentModel: String, options: List<ModelOption>): List<ModelOption> {
    val existing = options.ifEmpty {
        listOf(
            ModelOption("gpt-5.5", "GPT-5.5"),
            ModelOption("gpt-5", "GPT-5"),
            ModelOption("gpt-5-codex", "GPT-5 Codex"),
            ModelOption("o3", "o3")
        )
    }
    return if (existing.any { it.id == currentModel }) {
        existing
    } else {
        listOf(ModelOption(currentModel, currentModel)) + existing
    }
}

@Composable
private fun WorkspacePathBox(state: MobileUiState, viewModel: MobileViewModel) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, Hairline), Radius)
            .background(Canvas, Radius)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(Icons.Outlined.FolderOpen, contentDescription = null, tint = Muted, modifier = Modifier.size(18.dp))
        BasicTextField(
            value = state.workspacePathDraft,
            onValueChange = viewModel::updateWorkspacePathDraft,
            singleLine = true,
            textStyle = TextStyle(color = Ink, fontSize = 13.sp),
            cursorBrush = SolidColor(Focus),
            modifier = Modifier
                .weight(1f)
                .height(34.dp)
                .border(BorderStroke(1.dp, Hairline), RadiusSmall)
                .background(SurfaceSoft, RadiusSmall)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            decorationBox = { innerTextField ->
                if (state.workspacePathDraft.isBlank()) {
                    Text(
                        "/home/three/workspace/project",
                        color = Muted,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                innerTextField()
            }
        )
        Button(
            onClick = viewModel::openWorkspacePath,
            enabled = state.relayState == RelayConnectionState.Connected && state.workspacePathDraft.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = Canvas),
            shape = RadiusSmall,
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 0.dp),
            modifier = Modifier.height(34.dp)
        ) {
            Text(S.open, fontSize = 12.sp)
        }
    }
}

@Composable
private fun SessionsHeader(
    selected: SessionViewTab,
    workspaceCount: Int,
    sessionCount: Int,
    favoriteCount: Int,
    onSelect: (SessionViewTab) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, Hairline), RoundedCornerShape(12.dp))
            .background(Canvas, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                S.sessionBrowser,
                color = Ink,
                fontSize = 17.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(1f)
            )
            Text("$workspaceCount ${S.workspaces} · $sessionCount ${S.sessions}", color = Muted, fontSize = 12.sp)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            SessionViewTabButton(
                label = S.recent,
                count = sessionCount,
                selected = selected == SessionViewTab.Recent,
                modifier = Modifier.weight(1f),
                onClick = { onSelect(SessionViewTab.Recent) }
            )
            SessionViewTabButton(
                label = S.favorites,
                count = favoriteCount,
                selected = selected == SessionViewTab.Favorites,
                modifier = Modifier.weight(1f),
                onClick = { onSelect(SessionViewTab.Favorites) }
            )
            SessionViewTabButton(
                label = S.all,
                count = workspaceCount,
                selected = selected == SessionViewTab.All,
                modifier = Modifier.weight(1f),
                onClick = { onSelect(SessionViewTab.All) }
            )
        }
    }
}

@Composable
private fun SessionViewTabButton(
    label: String,
    count: Int,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Row(
        modifier = modifier
            .height(38.dp)
            .clip(RadiusSmall)
            .background(if (selected) Primary else SurfaceSoft, RadiusSmall)
            .border(BorderStroke(1.dp, if (selected) Primary else Hairline), RadiusSmall)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center
    ) {
        Text(
            text = label,
            color = if (selected) Canvas else Body,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        if (count > 0) {
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = count.toString(),
                color = if (selected) Canvas else Muted,
                fontSize = 11.sp,
                maxLines = 1
            )
        }
    }
}

@Composable
private fun WorkspaceBlock(
    workspace: Workspace,
    active: Boolean,
    collapsed: Boolean,
    activeSessionId: String?,
    onToggleCollapsed: () -> Unit,
    onOpenWorkspace: () -> Unit,
    onStartSession: () -> Unit,
    onRemoveWorkspace: () -> Unit,
    onOpenSession: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onRenameSession: (String, String, String) -> Unit,
    onRemoveSession: (String, String) -> Unit
) {
    var menuExpanded by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, if (active) BorderStrong else Hairline), RoundedCornerShape(12.dp))
            .background(if (active) SurfaceStrong else Canvas, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            IconButton(
                onClick = onToggleCollapsed,
                modifier = Modifier.size(34.dp)
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    contentDescription = if (collapsed) "Expand workspace" else "Collapse workspace",
                    tint = Muted,
                    modifier = Modifier
                        .size(20.dp)
                        .graphicsLayer(rotationZ = if (collapsed) 0f else 90f)
                )
            }
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clip(RadiusSmall)
                    .clickable(onClick = onOpenWorkspace)
                    .padding(horizontal = 6.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp)
            ) {
                Icon(Icons.Outlined.FolderOpen, contentDescription = null, tint = Body, modifier = Modifier.size(18.dp))
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(workspace.name, color = Ink, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(workspace.path, color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Box {
                IconButton(onClick = { menuExpanded = true }, modifier = Modifier.size(34.dp)) {
                    Icon(Icons.Outlined.MoreHoriz, contentDescription = "Workspace actions", tint = Ink, modifier = Modifier.size(19.dp))
                }
                DropdownMenu(
                    expanded = menuExpanded,
                    onDismissRequest = { menuExpanded = false },
                    modifier = Modifier
                        .background(Canvas)
                        .border(BorderStroke(1.dp, Hairline), RadiusSmall)
                ) {
                    DropdownMenuItem(
                        text = { Text(S.newSession, color = Ink, fontSize = 13.sp) },
                        leadingIcon = {
                            Icon(Icons.Outlined.Add, contentDescription = null, tint = Ink, modifier = Modifier.size(17.dp))
                        },
                        onClick = {
                            menuExpanded = false
                            onStartSession()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text(S.removeWorkspace, color = Danger, fontSize = 13.sp) },
                        leadingIcon = {
                            Icon(Icons.Outlined.DeleteOutline, contentDescription = null, tint = Danger, modifier = Modifier.size(17.dp))
                        },
                        onClick = {
                            menuExpanded = false
                            confirmRemove = true
                        }
                    )
                }
            }
        }
        if (!collapsed) {
            if (workspace.sessions.isEmpty()) {
                Text(
                    "No sessions in this workspace.",
                    color = Muted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(start = 42.dp, top = 2.dp, bottom = 4.dp)
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    workspace.sessions.forEach { session ->
                        SessionRow(
                            session = session,
                            meta = listOf(session.id.take(8), session.updatedAt).filter { it.isNotBlank() }.joinToString(" · "),
                            active = session.id == activeSessionId,
                            favorite = session.favorite,
                            onOpen = { onOpenSession(session.id) },
                            onToggleFavorite = { onToggleFavorite(session.id) },
                            onRename = { title -> onRenameSession(workspace.path, session.id, title) },
                            onRemove = { onRemoveSession(workspace.path, session.id) }
                        )
                    }
                }
            }
        }
    }
    if (confirmRemove) {
        AlertDialog(
            onDismissRequest = { confirmRemove = false },
            containerColor = Canvas,
            titleContentColor = Ink,
            textContentColor = Body,
            title = { Text("Remove ${workspace.name}?", fontSize = 18.sp, fontWeight = FontWeight.Medium) },
            text = {
                Text(
                    "This removes the workspace from Codex+. Session history on disk is not deleted.",
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmRemove = false
                        onRemoveWorkspace()
                    }
                ) {
                    Text(S.remove, color = Danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmRemove = false }) {
                    Text(S.cancel, color = Muted)
                }
            }
        )
    }
}

@Composable
private fun SessionRow(
    session: Session,
    meta: String,
    active: Boolean,
    favorite: Boolean,
    onOpen: () -> Unit,
    onToggleFavorite: () -> Unit,
    onRename: (String) -> Unit,
    onRemove: () -> Unit
) {
    var menuExpanded by remember { mutableStateOf(false) }
    var renameOpen by remember { mutableStateOf(false) }
    var removeOpen by remember { mutableStateOf(false) }
    var renameDraft by remember(session.id, session.title) { mutableStateOf(session.title) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(Radius)
            .background(if (active) SurfaceStrong else Canvas, Radius)
            .border(BorderStroke(1.dp, if (active) BorderStrong else Hairline), Radius)
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp)
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .clip(RadiusSmall)
                .clickable(onClick = onOpen)
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (session.status == "working") {
                        SessionWorkingIndicator()
                    }
                    Text(
                        session.title,
                        color = Ink,
                        fontSize = 15.sp,
                        lineHeight = 19.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    if (session.unread) {
                        StatusDot(active = true)
                    }
                }
                Text(
                    sessionMetaText(session, meta),
                    color = Muted,
                    fontSize = 12.sp,
                    lineHeight = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        if (session.status != "ready") {
            SessionStatusPill(session.status)
        }
        Box {
            IconButton(onClick = { menuExpanded = true }, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Outlined.MoreHoriz, contentDescription = "Session actions", tint = Muted, modifier = Modifier.size(18.dp))
            }
            DropdownMenu(
                expanded = menuExpanded,
                onDismissRequest = { menuExpanded = false },
                modifier = Modifier
                    .background(Canvas)
                    .border(BorderStroke(1.dp, Hairline), RadiusSmall)
            ) {
                DropdownMenuItem(
                    text = {
                        Text(
                            if (favorite) S.unfavorite else S.favorite,
                            color = Ink,
                            fontSize = 13.sp
                        )
                    },
                    leadingIcon = {
                        Icon(
                            if (favorite) Icons.Outlined.Star else Icons.Outlined.StarBorder,
                            contentDescription = null,
                            tint = if (favorite) Mustard else Ink,
                            modifier = Modifier.size(17.dp)
                        )
                    },
                    onClick = {
                        menuExpanded = false
                        onToggleFavorite()
                    }
                )
                DropdownMenuItem(
                    text = { Text(S.rename, color = Ink, fontSize = 13.sp) },
                    leadingIcon = {
                        Icon(Icons.Outlined.Edit, contentDescription = null, tint = Ink, modifier = Modifier.size(17.dp))
                    },
                    onClick = {
                        menuExpanded = false
                        renameDraft = session.title
                        renameOpen = true
                    }
                )
                DropdownMenuItem(
                    text = { Text(S.remove, color = Danger, fontSize = 13.sp) },
                    leadingIcon = {
                        Icon(Icons.Outlined.DeleteOutline, contentDescription = null, tint = Danger, modifier = Modifier.size(17.dp))
                    },
                    onClick = {
                        menuExpanded = false
                        removeOpen = true
                    }
                )
            }
        }
    }
    if (renameOpen) {
        AlertDialog(
            onDismissRequest = { renameOpen = false },
            containerColor = Canvas,
            titleContentColor = Ink,
            textContentColor = Body,
            title = { Text(S.renameSession, fontSize = 18.sp, fontWeight = FontWeight.Medium) },
            text = {
                BasicTextField(
                    value = renameDraft,
                    onValueChange = { renameDraft = it },
                    singleLine = true,
                    textStyle = TextStyle(color = Ink, fontSize = 15.sp),
                    cursorBrush = SolidColor(Focus),
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(BorderStroke(1.dp, Hairline), RadiusSmall)
                        .background(SurfaceSoft, RadiusSmall)
                        .padding(horizontal = 10.dp, vertical = 10.dp)
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val nextTitle = renameDraft.trim()
                        if (nextTitle.isNotBlank() && nextTitle != session.title) {
                            onRename(nextTitle)
                        }
                        renameOpen = false
                    }
                ) {
                    Text(S.save, color = Ink)
                }
            },
            dismissButton = {
                TextButton(onClick = { renameOpen = false }) {
                    Text(S.cancel, color = Muted)
                }
            }
        )
    }
    if (removeOpen) {
        AlertDialog(
            onDismissRequest = { removeOpen = false },
            containerColor = Canvas,
            titleContentColor = Ink,
            textContentColor = Body,
            title = { Text("Remove ${session.title}?", fontSize = 18.sp, fontWeight = FontWeight.Medium) },
            text = {
                Text(
                    "This removes the session from Codex+. Session history on disk is not deleted.",
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        removeOpen = false
                        onRemove()
                    }
                ) {
                    Text(S.remove, color = Danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { removeOpen = false }) {
                    Text(S.cancel, color = Muted)
                }
            }
        )
    }
}

@Composable
private fun SessionIcon(session: Session) {
    val working = session.status == "working"
    val transition = rememberInfiniteTransition(label = "session-icon-${session.id}")
    val pulseScale by transition.animateFloat(
        initialValue = 1f,
        targetValue = if (working) 1.06f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1100),
            repeatMode = RepeatMode.Reverse
        ),
        label = "session-icon-scale"
    )
    val pulseAlpha by transition.animateFloat(
        initialValue = if (working) 0.72f else 1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1100),
            repeatMode = RepeatMode.Reverse
        ),
        label = "session-icon-alpha"
    )
    Box(
        modifier = Modifier
            .size(36.dp)
            .graphicsLayer {
                scaleX = pulseScale
                scaleY = pulseScale
                alpha = pulseAlpha
            }
            .border(BorderStroke(1.dp, if (working) SuccessBorder else Hairline), RadiusSmall)
            .background(if (working) SuccessSoft else SurfaceSoft, RadiusSmall),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = if (working) Icons.Outlined.RadioButtonChecked else Icons.Outlined.ChatBubbleOutline,
            contentDescription = null,
            tint = if (working) Success else Body,
            modifier = Modifier.size(18.dp)
        )
    }
}

@Composable
private fun SessionWorkingIndicator() {
    val transition = rememberInfiniteTransition(label = "session-working-indicator")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(850),
            repeatMode = RepeatMode.Reverse
        ),
        label = "session-working-alpha"
    )
    Box(
        modifier = Modifier
            .size(7.dp)
            .graphicsLayer(alpha = alpha)
            .background(Success, CircleShape)
    )
}

@Composable
private fun SessionStatusPill(status: String) {
    val working = status == "working"
    val approval = status == "approval"
    Row(
        modifier = Modifier
            .border(
                BorderStroke(1.dp, when {
                    working -> SuccessBorder
                    approval -> Danger
                    else -> Hairline
                }),
                RoundedCornerShape(999.dp)
            )
            .background(
                when {
                    working -> SuccessSoft
                    approval -> DangerSoft
                    else -> Canvas
                },
                RoundedCornerShape(999.dp)
            )
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = status.ifBlank { "ready" },
            color = when {
                working -> Success
                approval -> Danger
                else -> Muted
            },
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1
        )
    }
}

@Composable
private fun SettingsScreen(state: MobileUiState, viewModel: MobileViewModel) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SurfaceSoft)
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        SettingsHero()
        SettingsPanel(title = S.appearanceLanguage) {
            SettingsChoiceRow(
                label = S.theme,
                options = listOf(
                    SettingsChoice(S.dark, AppThemeMode.Dark.name),
                    SettingsChoice(S.light, AppThemeMode.Light.name)
                ),
                selectedValue = state.themeMode.name,
                onSelect = { value ->
                    viewModel.updateThemeMode(AppThemeMode.valueOf(value))
                }
            )
            SettingsChoiceRow(
                label = S.language,
                options = listOf(
                    SettingsChoice(S.english, AppLanguage.English.name),
                    SettingsChoice(S.chinese, AppLanguage.Chinese.name)
                ),
                selectedValue = state.language.name,
                onSelect = { value ->
                    viewModel.updateLanguage(AppLanguage.valueOf(value))
                }
            )
        }

        SettingsPanel(title = S.connection) {
            OutlinedTextField(
                value = state.relayEndpoint,
                onValueChange = viewModel::updateRelayEndpoint,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(S.relayEndpoint) },
                singleLine = true,
                shape = Radius
            )
            OutlinedTextField(
                value = state.relayApiKey,
                onValueChange = viewModel::updateRelayApiKey,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(S.apiKey) },
                singleLine = true,
                shape = Radius
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = viewModel::refreshDevices,
                    enabled = state.relayEndpoint.isNotBlank() && state.relayApiKey.isNotBlank() && !state.devicesLoading,
                    colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Canvas),
                    shape = RadiusSmall
                ) {
                    Text(if (state.devicesLoading) S.loading else S.refreshDevices)
                }
                OutlinedButton(
                    onClick = viewModel::connectRelay,
                    enabled = state.hasRelaySettings,
                    border = BorderStroke(1.dp, Hairline),
                    shape = RadiusSmall
                ) {
                    Text(S.connect, color = Ink)
                }
            }
            if (state.desktopDevices.isEmpty()) {
                Text(S.noDesktopDevices, color = Muted, fontSize = 13.sp)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    state.desktopDevices.forEach { device ->
                        DeviceChoice(
                            device = device,
                            selected = device.deviceId == state.desktopDeviceId,
                            onSelect = { viewModel.updateDesktopDeviceId(device.deviceId) }
                        )
                    }
                }
            }
            if (state.relayError.isNotBlank()) {
                Text(state.relayError, color = Danger, fontSize = 13.sp)
            }
        }

        SettingsPanel(title = S.runtime) {
            SettingsInfoRow(Icons.Outlined.Wifi, S.relayMode, relayLabel(state.relayState))
            SettingsInfoRow(Icons.Outlined.DesktopWindows, S.desktop, if ((state.relayPresence?.desktopCount ?: 0) > 0) S.online else S.notConnected)
            SettingsInfoRow(Icons.Outlined.Code, S.model, state.model)
            SettingsInfoRow(Icons.Outlined.RadioButtonChecked, S.reasoning, state.modelEffort)
            SettingsInfoRow(Icons.Outlined.Check, S.permissions, state.permissionMode)
            SettingsInfoRow(Icons.Outlined.Smartphone, S.clientDevice, state.clientDeviceId.take(18))
        }

        SettingsPanel(title = S.notifications) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SettingsIconBox(Icons.Outlined.Notifications)
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(S.systemNotifications, color = Ink)
                    Text(S.notificationHelp, color = Muted, fontSize = 12.sp)
                }
                Switch(
                    checked = state.notificationsEnabled,
                    onCheckedChange = viewModel::updateNotificationsEnabled
                )
            }
        }

        SettingsPanel(title = if (IsChinese) "开发" else "Developer") {
            SettingsInfoRow(
                Icons.Outlined.Code,
                if (IsChinese) "版本" else "Version",
                "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"
            )
        }
    }
}

private fun sessionMetaText(session: Session, meta: String): String {
    return listOf(
        meta,
        if (session.status == "working" && session.turnStartedAt != null) "working" else "",
        session.lastTurnDurationMs?.let { "${it / 1000}s" }.orEmpty()
    ).filter { it.isNotBlank() }.joinToString(" · ")
}

private data class SettingsChoice(
    val label: String,
    val value: String
)

@Composable
private fun SettingsChoiceRow(
    label: String,
    options: List<SettingsChoice>,
    selectedValue: String,
    onSelect: (String) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SettingsIconBox(Icons.Outlined.Tune)
            Spacer(modifier = Modifier.width(12.dp))
            Text(label, color = Body, fontSize = 14.sp, modifier = Modifier.weight(1f))
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .border(BorderStroke(1.dp, Hairline), RadiusSmall)
                .background(SurfaceSoft, RadiusSmall)
                .padding(3.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            options.forEach { option ->
                val selected = option.value == selectedValue
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(34.dp)
                        .clip(RadiusSmall)
                        .background(if (selected) Primary else Color.Transparent, RadiusSmall)
                        .clickable { onSelect(option.value) },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = option.label,
                        color = if (selected) Canvas else Body,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

@Composable
private fun SettingsHero() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, Hairline), Radius)
            .background(Canvas, Radius)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Box(
            modifier = Modifier
                .size(42.dp)
                .clip(Radius)
                .background(Primary),
            contentAlignment = Alignment.Center
        ) {
            Text("C", color = Canvas, fontSize = 17.sp, fontWeight = FontWeight.Medium)
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Codex+ Mobile", color = Ink, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            Text(S.settingsHeroSubtitle, color = Muted, fontSize = 13.sp)
        }
    }
}

@Composable
private fun SettingsPanel(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, Hairline), RoundedCornerShape(12.dp))
            .background(Canvas, RoundedCornerShape(12.dp))
            .padding(13.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text(title, color = Ink, fontSize = 17.sp, fontWeight = FontWeight.Medium)
        content()
    }
}

@Composable
private fun DeviceChoice(device: RelayDesktopDevice, selected: Boolean, onSelect: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, onClick = onSelect)
            .border(BorderStroke(1.dp, if (selected) Ink else Hairline), Radius)
            .background(if (selected) SurfaceStrong else Canvas, Radius)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(
            selected = selected,
            onClick = onSelect,
            colors = RadioButtonDefaults.colors(selectedColor = Ink, unselectedColor = Muted)
        )
        Spacer(modifier = Modifier.width(8.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(device.deviceId, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "desktop ${device.desktopCount} · mobile ${device.clientCount}",
                color = Muted,
                fontSize = 12.sp
            )
        }
        StatusDot(active = device.connected)
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Muted, fontSize = 13.sp)
        Text(
            value.ifBlank { "-" },
            color = Ink,
            fontSize = 13.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 16.dp)
        )
    }
}

@Composable
private fun SettingsInfoRow(icon: ImageVector, label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(44.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        SettingsIconBox(icon)
        Spacer(modifier = Modifier.width(12.dp))
        Text(label, color = Body, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(
            value.ifBlank { "-" },
            color = Muted,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun SettingsIconBox(icon: ImageVector) {
    Box(
        modifier = Modifier
            .size(36.dp)
            .border(BorderStroke(1.dp, Hairline), RadiusSmall)
            .background(SurfaceSoft, RadiusSmall),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = null, tint = Body, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun EmptyState(title: String, body: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(1.dp, Hairline), Radius)
            .background(Canvas, Radius)
            .padding(15.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Text(title, color = Ink, fontWeight = FontWeight.Medium)
        Text(body, color = Muted, fontSize = 13.sp, lineHeight = 18.sp)
    }
}

@Composable
private fun headerSubtitle(state: MobileUiState): String {
    return when (state.selectedTab) {
        MobileTab.Chat -> listOf(
            state.model,
            state.modelEffort,
            state.permissionMode,
            if (state.isWorking) {
                if (IsChinese) "处理中" else "Working"
            } else {
                if (IsChinese) "就绪" else "Ready"
            }
        ).filter { it.isNotBlank() }.joinToString(" · ")

        MobileTab.Sessions -> if (IsChinese) "工作区和桌面会话" else "Workspaces and desktop sessions"
        MobileTab.Settings -> S.remotePreferences
    }
}

@Composable
private fun relayLabel(value: RelayConnectionState): String {
    return when (value) {
        RelayConnectionState.Disabled -> if (IsChinese) "已禁用" else "Disabled"
        RelayConnectionState.Disconnected -> if (IsChinese) "未连接" else "Disconnected"
        RelayConnectionState.Connecting -> if (IsChinese) "连接中" else "Connecting"
        RelayConnectionState.Connected -> if (IsChinese) "已连接" else "Connected"
        RelayConnectionState.Reconnecting -> if (IsChinese) "重连中" else "Reconnecting"
        RelayConnectionState.Error -> if (IsChinese) "错误" else "Error"
    }
}

private fun effortLabel(value: String): String {
    return EffortOptions.firstOrNull { it.value == value }?.label ?: value
}

private fun permissionLabel(value: String): String {
    return PermissionOptions.firstOrNull { it.value == value }?.label ?: value
}

private fun isHiddenChatMessage(message: Message): Boolean {
    if (message.role != "event") return false
    val meta = message.meta.trim().lowercase()
    val text = message.text.trim().lowercase().removeSuffix(".")
    return meta == "raw.notification" ||
        (meta == "turn" && (text == "turn started" || text == "turn completed"))
}

private suspend fun scrollChatToBottom(listState: LazyListState, itemCount: Int) {
    if (itemCount <= 0) return
    val lastIndex = itemCount - 1
    listState.scrollToItem(lastIndex)
    repeat(8) {
        withFrameNanos { }
        val layout = listState.layoutInfo
        val lastItem = layout.visibleItemsInfo.firstOrNull { it.index == lastIndex } ?: return@repeat
        val overflow = lastItem.offset + lastItem.size - layout.viewportEndOffset
        if (overflow > 0) {
            listState.scrollBy(overflow.toFloat())
        }
    }
}
