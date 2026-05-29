import {
  ArrowUp,
  AtSign,
  CalendarClock,
  ChevronRight,
  Check,
  Copy,
  Download,
  FolderOpen,
  Languages,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Settings,
  Square,
  Sun,
  Trash2,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClipboardEvent,
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  ReactNode
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CodexAdapterEvent, Thread, UserInput } from "@codep/codex-adapter";
import type { DesktopUpdateInfo, PeriodicTask, PeriodicTaskInput } from "./global";
import defaultNotificationSoundUrl from "../zelda-chest.wav?url";
import desktopPackage from "../package.json";

interface SessionView {
  threadId: string;
  title: string;
  updatedAt?: number;
  status?: string;
}

type WorkspaceSessionMap = Record<string, SessionView[]>;

interface TranscriptEntry {
  id: string;
  role:
    | "user"
    | "assistant"
    | "system"
    | "turn"
    | "command"
    | "commandOutput"
    | "tool"
    | "edited"
    | "viewedImage"
    | "interaction"
    | "search"
    | "plan"
    | "diff"
    | "approval";
  text: string;
  meta?: string;
  createdAt?: number;
}

type TranscriptUpdater = (previous: TranscriptEntry[]) => TranscriptEntry[];

interface ApprovalEntry {
  id: string | number;
  type: string;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  request: unknown;
  raw: CodexAdapterEvent;
}

interface ComposerAttachment {
  id: string;
  type: "localImage" | "mention";
  path: string;
  name: string;
  previewDataUrl?: string;
}

interface QueuedRemoteTurn {
  text: string;
  attachments: ComposerAttachment[];
  session: SessionView;
}

interface ClipboardAttachmentResult {
  attachments: ComposerAttachment[];
  formats: string[];
}

type RemoteAttachmentInput =
  | {
      kind: "image";
      name: string;
      mimeType: string;
      dataUrl: string;
    }
  | {
      kind: "mention";
      name: string;
      path: string;
    };

interface ComposerSuggestion {
  id: string;
  type: "file" | "skill";
  label: string;
  name: string;
  detail?: string;
  insertText: string;
  path?: string;
}

interface NotificationSoundFile {
  path: string;
  url: string;
  name: string;
}

type ConnectionState = "disconnected" | "connecting" | "connected";
type RelayConnectionState =
  | "disabled"
  | "connecting"
  | "connected"
  | "retrying"
  | "auth_error"
  | "error";
type PermissionMode = "default" | "auto-review" | "full-access";
type ThemeMode = "dark" | "light";
type ModelEffort = "low" | "medium" | "high" | "xhigh";
type ComposerCompletionMode = "file" | "skill";
type UILanguage = "en" | "zh-CN";
type MainView = "conversation";

interface ComposerCompletionState {
  mode: ComposerCompletionMode;
  query: string;
  tokenStart: number;
  cursor: number;
  items: ComposerSuggestion[];
  selectedIndex: number;
  loading: boolean;
}

interface ContextUsage {
  usedTokens: number;
  contextWindow: number | null;
}

interface RateLimitWindowUsage {
  leftPercent: number | null;
}

interface RateLimitUsage {
  primary: RateLimitWindowUsage | null;
  secondary: RateLimitWindowUsage | null;
}

interface ModelOption {
  id: string;
  label: string;
}

interface RelayEnvelope {
  type: string;
  payload?: unknown;
}

interface RelayPresence {
  desktopCount: number;
  clientCount: number;
  connected: boolean;
  lastSeen?: string;
}

interface RemoteCommandEnvelope {
  type: string;
  payload?: {
    client_message_id?: string;
    workspace?: string;
    sessionId?: string;
    title?: string;
    text?: string;
    attachments?: RemoteAttachmentInput[];
    permissionMode?: PermissionMode;
    model?: string;
    effort?: ModelEffort;
    requestId?: string | number;
    decision?: "accept" | "decline" | "cancel";
    mode?: "file" | "skill";
    query?: string;
    limit?: number;
    path?: string;
    maxBytes?: number;
  };
}

interface RemoteSnapshotMessage {
  id: string;
  role: "user" | "codex" | "event";
  text: string;
  meta?: string;
  createdAt?: number;
}

interface RelayProgressPayload {
  sessionId: string;
  turnId: string;
  isWorking?: boolean;
  message?: RemoteSnapshotMessage;
  event?: RemoteSnapshotMessage;
}

interface RemoteSnapshotWorkspace {
  path: string;
  name: string;
  sessions: Array<{
    id: string;
    title: string;
    updatedAt: string;
    status: string;
    unread?: boolean;
    activeTurnId?: string | null;
    turnStartedAt?: number | null;
    lastTurnDurationMs?: number | null;
  }>;
}

const WORKSPACE_STORAGE_KEY = "codep.lastWorkspace";
const WORKSPACES_STORAGE_KEY = "codep.workspaces";
const SESSION_STORAGE_KEY = "codep.sessionsByWorkspace";
const SESSION_LIST_CACHE_STORAGE_KEY = "codep.sessionListCacheByWorkspace";
const SESSION_TITLE_OVERRIDES_STORAGE_KEY = "codep.sessionTitleOverrides";
const HIDDEN_SESSIONS_STORAGE_KEY = "codep.hiddenSessions";
const COLLAPSED_WORKSPACES_STORAGE_KEY = "codep.collapsedWorkspaces";
const RELAY_ENDPOINT_STORAGE_KEY = "codep.relayEndpoint";
const RELAY_API_KEY_STORAGE_KEY = "codep.relayApiKey";
const RELAY_DEVICE_ID_STORAGE_KEY = "codep.relayDeviceId";
const CLOUD_RELAY_ENDPOINT = "wss://codex-bridge.three.ink";
const PERMISSIONS_STORAGE_KEY = "codep.defaultPermissions";
const THEME_STORAGE_KEY = "codep.theme";
const LANGUAGE_STORAGE_KEY = "codep.language";
const MODEL_STORAGE_KEY = "codep.model";
const MODEL_EFFORT_STORAGE_KEY = "codep.modelEffort";
const UNREAD_SESSIONS_STORAGE_KEY = "codep.unreadSessions";
const SOUND_NOTIFICATIONS_STORAGE_KEY = "codep.soundNotifications";
const NOTIFICATION_SOUND_FILE_STORAGE_KEY = "codep.notificationSoundFile";
const NOTIFICATION_SOUND_VOLUME_STORAGE_KEY = "codep.notificationSoundVolume";
const UPDATE_DISMISSED_STORAGE_KEY = "codep.dismissedUpdateVersion";
const DEFAULT_NOTIFICATION_SOUND_FILE: NotificationSoundFile = {
  path: "bundled://zelda-chest.wav",
  url: defaultNotificationSoundUrl,
  name: "zelda-chest.wav"
};
const DEFAULT_NOTIFICATION_SOUND_VOLUME = 70;
const APP_VERSION_LABEL = `v${desktopPackage.version}`;
const INITIAL_VISIBLE_TRANSCRIPT_COUNT = 40;
const TRANSCRIPT_PAGE_SIZE = 40;
const BACKGROUND_SESSION_REFRESH_DELAY_MS = 350;
const RELIABLE_RELAY_RETRY_MS = 5000;
const DESKTOP_SNAPSHOT_DEBOUNCE_MS = 500;
const RELIABLE_SNAPSHOT_DEBOUNCE_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const RATE_LIMIT_REFRESH_INTERVAL_MS = 15_000;
const RELAY_EVENT_TEXT_MAX_CHARS = 1200;
const RELAY_MESSAGE_TEXT_MAX_CHARS = 4000;
const RELAY_PROGRESS_DEBOUNCE_MS = 1000;
const STREAM_TRANSCRIPT_FLUSH_MS = 300;
const RELAY_RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10000, 30000] as const;
const RELAY_RECONNECT_JITTER_MS = 500;
const RELAY_STABLE_CONNECTION_MS = 30000;
const CLIENT_COMMAND_IDS_STORAGE_KEY = "codep.processedClientCommandIds";
type SidebarTab = "all" | "recent" | "automations";
const LANGUAGE_OPTIONS: Array<{ value: UILanguage; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" }
];
const UI_TEXT = {
  en: {
    localWorkspace: "Local Codex workspace",
    expandSidebar: "Expand sidebar",
    collapseSidebar: "Collapse sidebar",
    openSession: "Open",
    sessions: "Sessions",
    workspaces: "Workspaces",
    latest: "Latest",
    new: "New",
    addWorkspace: "Add workspace",
    newConversation: "New conversation",
    chooseConversationWorkspace: "Choose workspace",
    chooseConversationWorkspaceBody: "Start a new Codex session in one workspace.",
    createConversation: "Create conversation",
    cancel: "Cancel",
    sessionViews: "Session views",
    all: "All",
    recent: "Recent",
    automationsTab: "Automations",
    loadingSessions: "Loading sessions...",
    noSessionsLoaded: "No sessions loaded",
    recentEmpty: "Recent sessions appear here after workspace history loads.",
    workspaceEmpty: "Add one or more workspaces, then open a session under any of them.",
    conversation: "Conversation",
    newCodexSession: "New Codex session",
    openSettings: "Open settings",
    updateAvailable: "Update available",
    updateAvailableBody: "Version {version} has been downloaded and is ready to install.",
    updateAvailableBodyRemote: "Version {version} is ready to download.",
    downloadUpdate: "Open file",
    openRelease: "Open release",
    dismissUpdate: "Dismiss update notice",
    startSessionTitle: "Start a local Codex session",
    startSessionBody: "Add workspaces on the left, then open or create a session under any workspace.",
    loadingSessionTitle: "Loading session",
    loadingSessionBody: "Resuming Codex history for this workspace.",
    loadOlderMessages: "Load {count} older messages",
    hiddenMessages: "{count} hidden",
    working: "Working",
    ready: "Ready",
    noSession: "No session",
    attachedFiles: "Attached files",
    image: "Image",
    fileMention: "File mention",
    messageCodex: "Message Codex",
    composerPlaceholder: "Ask Codex to inspect, edit, explain, or test this workspace",
    attachFile: "Attach file",
    searchFiles: "Search files",
    searchSkills: "Search skills",
    files: "Files",
    skills: "Skills",
    switchModel: "Switch model",
    model: "Model",
    switchEffort: "Switch reasoning effort",
    reasoningEffort: "Reasoning effort",
    switchPermissions: "Switch permissions",
    permissions: "Permissions",
    stopTurn: "Stop current turn",
    sendMessage: "Send message",
    workspaceActions: "Workspace actions for {name}",
    newSession: "New session",
    removeWorkspace: "Remove workspace",
    noMatchingFiles: "No matching files",
    noMatchingSkills: "No matching skills",
    searching: "Searching...",
    accept: "Accept",
    decline: "Decline",
    account: "Account",
    fiveHourLimit: "5h limit",
    weeklyLimit: "Weekly limit",
    rateLimitUnknown: "Not reported",
    quickTheme: "Quick theme",
    quickLanguage: "Quick language",
    settings: "Settings",
    settingsIntro: "Configure remote access for desktop and mobile clients.",
    closeSettings: "Close settings",
    periodicTasks: "Automations",
    openPeriodicTasks: "Open automations",
    periodicTasksIntro: "Run a prompt by interval or on a fixed daily/weekly schedule.",
    editTask: "Edit automation",
    newTask: "New task",
    taskName: "Task name",
    targetWorkspace: "Workspace",
    targetSession: "Target session",
    sessionMode: "Session mode",
    existingSession: "Existing session",
    dedicatedSession: "New session",
    triggerType: "Trigger",
    triggerInterval: "After completion",
    triggerSchedule: "Fixed time",
    intervalMinutes: "Interval minutes",
    scheduleFrequency: "Schedule",
    scheduleDaily: "Every day",
    scheduleWeekly: "Weekly",
    scheduleTime: "Time",
    scheduleWeekdays: "Weekdays",
    taskPrompt: "Prompt",
    enabled: "Enabled",
    runNow: "Run now",
    pause: "Pause",
    resume: "Resume",
    deleteTask: "Delete task",
    saveTask: "Save task",
    createTask: "Create task",
    noTasks: "No automations",
    noTasksBody: "Create a task that runs by interval or at a fixed time.",
    taskTypeInterval: "Loop",
    taskTypeSchedule: "Scheduled",
    taskCount: "{count} automations",
    lastRun: "Last run",
    nextRun: "Next run",
    openTaskSession: "Open session",
    taskSessionPending: "Created on each run.",
    taskSaved: "Automation saved.",
    taskDeleted: "Automation deleted.",
    taskStarted: "Automation queued.",
    appearance: "Appearance",
    appearanceIntro: "Choose the theme and language for desktop UI surfaces.",
    theme: "Theme",
    language: "Language",
    dark: "Dark",
    light: "Light",
    notifications: "Notifications",
    notificationsIntro: "Show session unread dots when a turn completes away from the active view. Sound can also play on every completed turn.",
    soundOnTurnCompletion: "Sound on turn completion",
    soundOnTurnCompletionHelp: "Play a short sound when Codex finishes a turn.",
    soundVolume: "Volume",
    audioFile: "Audio file",
    defaultTone: "Default tone",
    chooseFile: "Choose file",
    clear: "Clear",
    modelIntro: "Choose the model and reasoning level used for new, resumed, and next turns.",
    reasoningLevel: "Reasoning level",
    permissionsIntro: "Choose the default approval behavior for new, resumed, and next turns. The quick selector under the composer changes the same value.",
    defaultPermissions: "Default /permissions",
    relay: "Relay",
    relayIntro: "Use the same endpoint and API key on the mobile app. The key is saved locally on this desktop.",
    endpoint: "Endpoint",
    apiKey: "API key",
    status: "Status",
    relayConnected: "Relay is connected and ready for mobile clients.",
    relayConnecting: "Relay credentials are configured. Connecting...",
    relayRetrying: "Relay is disconnected. Reconnecting in {seconds}s...",
    relayAuthError: "Relay rejected the API key. Check the desktop and mobile credentials.",
    relayConnectionError: "Relay connection failed. Waiting to reconnect...",
    relayMissing: "Create an API key on the relay server, then paste it here and in the mobile app.",
    mobileClientsOnline: "{count} mobile client(s) online.",
    noMobileClientsOnline: "No mobile clients online.",
    mobileClients: "Mobile clients",
    mobileClientsShort: "mobile",
    notSet: "Not set",
    deviceId: "Device ID",
    desktopUrl: "Desktop URL",
    notReady: "Not ready",
    saved: "Saved",
    missing: "Missing",
    copy: "Copy",
    copied: "Copied",
    copyApiKey: "Copy API key",
    copyDeviceId: "Copy Device ID",
    connection: "Connection",
    defaultPermissionLabel: "Default",
    defaultPermissionDescription: "Codex can read and edit files in the current workspace, and run commands. Approval is required for internet access or edits outside the workspace.",
    autoReviewPermissionLabel: "Auto-review",
    autoReviewPermissionDescription: "Same workspace-write permissions as Default, but eligible approvals are routed through the auto-reviewer subagent.",
    fullAccessPermissionLabel: "Full Access",
    fullAccessPermissionDescription: "Codex can edit files outside this workspace and access the internet without asking for approval.",
    effortLowLabel: "Fast",
    effortLowDescription: "Lowest reasoning latency.",
    effortMediumLabel: "Medium",
    effortMediumDescription: "Balanced speed and depth.",
    effortHighLabel: "High",
    effortHighDescription: "Deeper reasoning for harder tasks.",
    effortXHighLabel: "XHigh",
    effortXHighDescription: "Maximum reasoning depth.",
    contextUnknown: "Unknown",
    contextLeft: "{value} left",
    contextUsed: "{value} used",
    contextUnknownTooltip: "Context usage has not been reported yet.",
    contextRemainingTooltip: "{remaining} remaining of {total} ({percent}%)",
    contextUsedTooltip: "{value} tokens used.",
    roleCodex: "Codex",
    roleYou: "You",
    roleSystem: "System",
    roleTurn: "Turn",
    roleRan: "Ran",
    roleOutput: "Output",
    roleTool: "Tool",
    roleEdited: "Edited",
    roleViewedImage: "Viewed Image",
    roleInteracted: "Interacted",
    roleSearch: "Search",
    rolePlan: "Plan",
    roleDiff: "Diff",
    roleApproval: "Approval",
    sessionName: "Session name",
    saveSessionName: "Save session name",
    cancelRename: "Cancel rename",
    unreadTurn: "Unread turn",
    renameSession: "Rename {title}",
    removeSession: "Remove {title}",
    removeSessionConfirm: "Remove {title} from Codex+? Codex session history on disk will not be deleted.",
  },
  "zh-CN": {
    localWorkspace: "本地 Codex 工作区",
    expandSidebar: "展开侧边栏",
    collapseSidebar: "折叠侧边栏",
    openSession: "打开",
    sessions: "Sessions",
    workspaces: "工作区",
    latest: "最新",
    new: "新建",
    addWorkspace: "添加工作区",
    newConversation: "新建对话",
    chooseConversationWorkspace: "选择工作区",
    chooseConversationWorkspaceBody: "在一个工作区里启动新的 Codex Session。",
    createConversation: "创建对话",
    cancel: "取消",
    sessionViews: "Session 视图",
    all: "全部",
    recent: "最近",
    automationsTab: "自动化",
    loadingSessions: "正在加载 Session...",
    noSessionsLoaded: "还没有加载 Session",
    recentEmpty: "加载工作区历史后，最近使用的 Session 会显示在这里。",
    workspaceEmpty: "先添加一个或多个工作区，然后打开或创建 Session。",
    conversation: "对话",
    newCodexSession: "新的 Codex Session",
    openSettings: "打开设置",
    updateAvailable: "发现新版本",
    updateAvailableBody: "{version} 版本已下载，可以安装。",
    updateAvailableBodyRemote: "{version} 版本已可下载。",
    downloadUpdate: "打开文件",
    openRelease: "打开 Release",
    dismissUpdate: "关闭版本提示",
    startSessionTitle: "开始本地 Codex Session",
    startSessionBody: "在左侧添加工作区，然后打开或创建该工作区下的 Session。",
    loadingSessionTitle: "正在加载 Session",
    loadingSessionBody: "正在恢复这个工作区的 Codex 历史。",
    loadOlderMessages: "加载更早的 {count} 条消息",
    hiddenMessages: "已隐藏 {count} 条",
    working: "Working",
    ready: "Ready",
    noSession: "无 Session",
    attachedFiles: "已附加文件",
    image: "图片",
    fileMention: "文件引用",
    messageCodex: "给 Codex 发消息",
    composerPlaceholder: "让 Codex 检查、修改、解释或测试这个工作区",
    attachFile: "附加文件",
    searchFiles: "搜索文件",
    searchSkills: "搜索技能",
    files: "文件",
    skills: "技能",
    switchModel: "切换模型",
    model: "模型",
    switchEffort: "切换推理强度",
    reasoningEffort: "推理强度",
    switchPermissions: "切换权限",
    permissions: "权限",
    stopTurn: "停止当前 Turn",
    sendMessage: "发送消息",
    workspaceActions: "{name} 的工作区操作",
    newSession: "新建 Session",
    removeWorkspace: "移除工作区",
    noMatchingFiles: "没有匹配的文件",
    noMatchingSkills: "没有匹配的技能",
    searching: "搜索中...",
    accept: "允许",
    decline: "拒绝",
    account: "账号",
    fiveHourLimit: "5h limit",
    weeklyLimit: "Weekly limit",
    rateLimitUnknown: "暂无额度",
    quickTheme: "快速切换主题",
    quickLanguage: "快速切换语言",
    settings: "设置",
    settingsIntro: "配置桌面端和移动端的远程访问。",
    closeSettings: "关闭设置",
    periodicTasks: "自动任务",
    openPeriodicTasks: "打开自动任务",
    periodicTasksIntro: "按完成后的间隔运行，或按每天/每周固定时间运行同一条 Prompt。",
    editTask: "编辑自动任务",
    newTask: "新建任务",
    taskName: "任务名称",
    targetWorkspace: "工作区",
    targetSession: "目标 Session",
    sessionMode: "Session 模式",
    existingSession: "已有 Session",
    dedicatedSession: "新 Session",
    triggerType: "触发方式",
    triggerInterval: "完成后间隔",
    triggerSchedule: "固定时间",
    intervalMinutes: "间隔分钟",
    scheduleFrequency: "定时规则",
    scheduleDaily: "每天",
    scheduleWeekly: "每周",
    scheduleTime: "时间",
    scheduleWeekdays: "周几",
    taskPrompt: "Prompt",
    enabled: "启用",
    runNow: "立即运行",
    pause: "暂停",
    resume: "恢复",
    deleteTask: "删除任务",
    saveTask: "保存任务",
    createTask: "创建任务",
    noTasks: "还没有自动任务",
    noTasksBody: "创建一个按间隔或固定时间运行的任务。",
    taskTypeInterval: "循环",
    taskTypeSchedule: "定时",
    taskCount: "{count} 个自动任务",
    lastRun: "上次运行",
    nextRun: "下次运行",
    openTaskSession: "打开 Session",
    taskSessionPending: "每次运行时创建。",
    taskSaved: "自动任务已保存。",
    taskDeleted: "自动任务已删除。",
    taskStarted: "自动任务已排队。",
    appearance: "外观",
    appearanceIntro: "选择桌面端界面的主题和语言。",
    theme: "主题",
    language: "语言",
    dark: "深色",
    light: "浅色",
    notifications: "提醒",
    notificationsIntro: "当 Turn 在非当前视图完成时显示 Session 未读红点，也可以播放提示音。",
    soundOnTurnCompletion: "Turn 结束提示音",
    soundOnTurnCompletionHelp: "Codex 完成一个 Turn 后播放短提示音。",
    soundVolume: "音量",
    audioFile: "音频文件",
    defaultTone: "默认提示音",
    chooseFile: "选择文件",
    clear: "清除",
    modelIntro: "选择新建、恢复以及下一次 Turn 使用的模型和推理强度。",
    reasoningLevel: "推理强度",
    permissionsIntro: "选择新建、恢复以及下一次 Turn 的默认审批行为。输入框下方的快捷选择也会修改同一个值。",
    defaultPermissions: "默认 /permissions",
    relay: "中转服务",
    relayIntro: "移动端使用相同的 endpoint 和 API key。密钥只保存在这台桌面端本地。",
    endpoint: "Endpoint",
    apiKey: "API key",
    status: "状态",
    relayConnected: "中转服务已连接，可以供移动端使用。",
    relayConnecting: "中转凭据已配置，正在连接...",
    relayRetrying: "中转服务已断开，将在 {seconds} 秒后重连...",
    relayAuthError: "中转服务拒绝了 API key，请检查桌面端和移动端凭据。",
    relayConnectionError: "中转服务连接失败，正在等待重连...",
    relayMissing: "先在中转服务创建 API key，然后粘贴到桌面端和移动端。",
    mobileClientsOnline: "{count} 台移动端在线。",
    noMobileClientsOnline: "暂无移动端在线。",
    mobileClients: "移动端",
    mobileClientsShort: "移动端",
    notSet: "未设置",
    deviceId: "设备 ID",
    desktopUrl: "桌面端 URL",
    notReady: "未就绪",
    saved: "已保存",
    missing: "缺失",
    copy: "复制",
    copied: "已复制",
    copyApiKey: "复制 API key",
    copyDeviceId: "复制设备 ID",
    connection: "连接",
    defaultPermissionLabel: "Default",
    defaultPermissionDescription: "Codex 可以读取和编辑当前工作区内的文件，并运行命令。访问互联网或编辑工作区外文件时需要审批。",
    autoReviewPermissionLabel: "Auto-review",
    autoReviewPermissionDescription: "与 Default 拥有相同的工作区写入权限，但符合条件的审批会交给 auto-reviewer 子 Agent。",
    fullAccessPermissionLabel: "Full Access",
    fullAccessPermissionDescription: "Codex 可以编辑工作区外文件并访问互联网，不再请求审批。请谨慎使用。",
    effortLowLabel: "Fast",
    effortLowDescription: "最低推理延迟。",
    effortMediumLabel: "Medium",
    effortMediumDescription: "在速度和深度之间平衡。",
    effortHighLabel: "High",
    effortHighDescription: "更深入的推理，适合复杂任务。",
    effortXHighLabel: "XHigh",
    effortXHighDescription: "最高推理深度。",
    contextUnknown: "Unknown",
    contextLeft: "剩余 {value}",
    contextUsed: "已用 {value}",
    contextUnknownTooltip: "暂未收到上下文用量。",
    contextRemainingTooltip: "剩余 {remaining} / {total} ({percent}%)",
    contextUsedTooltip: "已使用 {value} tokens。",
    roleCodex: "Codex",
    roleYou: "你",
    roleSystem: "System",
    roleTurn: "Turn",
    roleRan: "Ran",
    roleOutput: "Output",
    roleTool: "Tool",
    roleEdited: "Edited",
    roleViewedImage: "Viewed Image",
    roleInteracted: "Interacted",
    roleSearch: "Search",
    rolePlan: "Plan",
    roleDiff: "Diff",
    roleApproval: "Approval",
    sessionName: "Session 名称",
    saveSessionName: "保存 Session 名称",
    cancelRename: "取消重命名",
    unreadTurn: "未读 Turn",
    renameSession: "重命名 {title}",
    removeSession: "移除 {title}",
    removeSessionConfirm: "从 Codex+ 移除 {title}？磁盘上的 Codex Session 历史不会被删除。",
  }
} as const;
type UIMessageKey = keyof typeof UI_TEXT.en;

function textFor(
  language: UILanguage,
  key: UIMessageKey,
  values: Record<string, string | number> = {}
): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    String(UI_TEXT[language][key] ?? UI_TEXT.en[key])
  );
}
const PERMISSION_OPTIONS: Array<{
  value: PermissionMode;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "Default",
    description:
      "Codex can read and edit files in the current workspace, and run commands. Approval is required for internet access or edits outside the workspace."
  },
  {
    value: "auto-review",
    label: "Auto-review",
    description:
      "Same workspace-write permissions as Default, but eligible approvals are routed through the auto-reviewer subagent."
  },
  {
    value: "full-access",
    label: "Full Access",
    description:
      "Codex can edit files outside this workspace and access the internet without asking for approval."
  }
];
const FALLBACK_MODEL_OPTIONS: ModelOption[] = [
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-codex", label: "GPT-5 Codex" },
  { id: "o3", label: "o3" }
];
const EFFORT_OPTIONS: Array<{
  value: ModelEffort;
  label: string;
  description: string;
}> = [
  { value: "low", label: "Fast", description: "Lowest reasoning latency." },
  { value: "medium", label: "Medium", description: "Balanced speed and depth." },
  { value: "high", label: "High", description: "Deeper reasoning for harder tasks." },
  { value: "xhigh", label: "XHigh", description: "Maximum reasoning depth." }
];
const WEEKDAY_OPTIONS = [
  { value: 1, en: "Mon", zh: "周一" },
  { value: 2, en: "Tue", zh: "周二" },
  { value: 3, en: "Wed", zh: "周三" },
  { value: 4, en: "Thu", zh: "周四" },
  { value: 5, en: "Fri", zh: "周五" },
  { value: 6, en: "Sat", zh: "周六" },
  { value: 0, en: "Sun", zh: "周日" }
];
const DEMO_MODE =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("demo") === "1";
const DEMO_WORKSPACE = "/home/three/workspace/test_codexp";
const DEMO_SESSION: SessionView = {
  threadId: "demo-thread-019e",
  title: "Demo Codex session",
  updatedAt: Math.floor(Date.now() / 1000)
};
const DEMO_TRANSCRIPT: TranscriptEntry[] = [
  { id: "demo-user-1", role: "user", text: "帮我查一下最近的新闻有什么" },
  {
    id: "demo-command-1",
    role: "command",
    text: "rg \"fal_generate|gpt_image\" internal beeseed-worker",
    meta: "exec_command"
  },
  {
    id: "demo-output-1",
    role: "commandOutput",
    text: "internal/fal/proxy.go: model alias gpt_image\nbeeseed-worker/internal/tool/fal_generate.go: enum includes gpt_image",
    meta: "stdout"
  },
  {
    id: "demo-image-1",
    role: "viewedImage",
    text: "/tmp/codep-demo-edited-ran.png",
    meta: "view_image"
  },
  {
    id: "demo-interaction-1",
    role: "interaction",
    text: "Interacted with background terminal\nnpm run dev:vite -w @codep/desktop -- --port 5174",
    meta: "write_stdin"
  },
  {
    id: "demo-edited-1",
    role: "edited",
    text:
      "apps/desktop/src/App.tsx (+4 -1)\n\n```diff\n@@ -1304,7 +1304,10 @@ function editedSummary(value: unknown): string {\n-  return \"Edited files\";\n+  const changes = fileChanges(record);\n+  if (changes.length > 0) {\n+    return changes.map(formatFileChange).join(\"\\n\\n\");\n+  }\n```",
    meta: "apply_patch"
  },
  {
    id: "demo-assistant-1",
    role: "assistant",
    text:
      "截至北京时间 **2026年5月24日**，最近几条主要新闻是：\n\n- 乌克兰局势：多地遭遇袭击，来源：[AP](https://apnews.com)\n- 中东谈判：相关方继续讨论停火条件，来源：[Reuters](https://reuters.com)\n- 科技行业：AI 图像模型继续更新，支持更高质量输出。\n\n```bash\nnpm run build\n```",
    meta: "final_answer"
  },
  { id: "demo-system", role: "system", text: "Session resumed in demo workspace" }
];

export function App() {
  const desktopApi = window.codexApp;
  const [connectionState, setConnectionState] =
    useState<ConnectionState>(DEMO_MODE ? "connected" : "disconnected");
  const [workspaces, setWorkspaces] = useState<string[]>(() =>
    DEMO_MODE ? [DEMO_WORKSPACE] : readSavedWorkspaces()
  );
  const [workspace, setWorkspace] = useState<string | null>(() =>
    DEMO_MODE
      ? DEMO_WORKSPACE
      : window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ??
        readSavedWorkspaces()[0] ??
        null
  );
  const [session, setSession] = useState<SessionView | null>(
    DEMO_MODE ? DEMO_SESSION : null
  );
  const [workspaceSessions, setWorkspaceSessions] = useState<WorkspaceSessionMap>(
    DEMO_MODE
      ? { [DEMO_WORKSPACE]: [DEMO_SESSION] }
      : readCachedWorkspaceSessions(
          readSavedWorkspaces(),
          new Set(readStringList(HIDDEN_SESSIONS_STORAGE_KEY))
        )
  );
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("recent");
  const [hiddenSessionIds, setHiddenSessionIds] = useState<Set<string>>(
    () => new Set(readStringList(HIDDEN_SESSIONS_STORAGE_KEY))
  );
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(
    () => new Set(readStringList(UNREAD_SESSIONS_STORAGE_KEY))
  );
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(
    () => new Set(readStringList(COLLAPSED_WORKSPACES_STORAGE_KEY))
  );
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);
  const [isSessionOpening, setIsSessionOpening] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>(
    DEMO_MODE ? DEMO_TRANSCRIPT : []
  );
  const transcriptRef = useRef<TranscriptEntry[]>(DEMO_MODE ? DEMO_TRANSCRIPT : []);
  const [approvals, setApprovals] = useState<ApprovalEntry[]>([]);
  const [composer, setComposer] = useState("");
  const [composerCompletion, setComposerCompletion] =
    useState<ComposerCompletionState | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [runningTurnsBySession, setRunningTurnsBySession] = useState<
    Record<string, string>
  >({});
  const [turnStartedAtBySession, setTurnStartedAtBySession] = useState<
    Record<string, number>
  >({});
  const [lastTurnDurationBySession, setLastTurnDurationBySession] = useState<
    Record<string, number>
  >({});
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [relayEndpoint, setRelayEndpoint] = useState(
    () => readSavedRelayEndpoint()
  );
  const [relayApiKey, setRelayApiKey] = useState(
    () => window.localStorage.getItem(RELAY_API_KEY_STORAGE_KEY) ?? ""
  );
  const [relayRetryDelayMs, setRelayRetryDelayMs] = useState<number | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() =>
    readSavedPermissionMode()
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readSavedThemeMode());
  const [language, setLanguage] = useState<UILanguage>(() => readSavedLanguage());
  const [model, setModel] = useState(() => readSavedModel());
  const [modelEffort, setModelEffort] = useState<ModelEffort>(() =>
    readSavedModelEffort()
  );
  const [soundNotificationsEnabled, setSoundNotificationsEnabled] = useState(
    () => window.localStorage.getItem(SOUND_NOTIFICATIONS_STORAGE_KEY) === "true"
  );
  const [notificationSoundVolume, setNotificationSoundVolume] = useState(() =>
    readSavedNotificationSoundVolume()
  );
  const [notificationSoundFile, setNotificationSoundFile] =
    useState<NotificationSoundFile | null>(() => readSavedNotificationSoundFile());
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(FALLBACK_MODEL_OPTIONS);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [rateLimitUsage, setRateLimitUsage] = useState<RateLimitUsage | null>(null);
  const [relayState, setRelayState] = useState<RelayConnectionState>("disabled");
  const [relayError, setRelayError] = useState("");
  const [relayPresence, setRelayPresence] = useState<RelayPresence | null>(null);
  const [deviceId] = useState(() => storedDeviceId());
  const [visibleTranscriptCount, setVisibleTranscriptCount] = useState(
    INITIAL_VISIBLE_TRANSCRIPT_COUNT
  );
  const [scrollRequest, setScrollRequest] = useState(0);
  const [historyLoadRequest, setHistoryLoadRequest] = useState(0);
  const [mainView, setMainView] = useState<MainView>("conversation");
  const [periodicTasks, setPeriodicTasks] = useState<PeriodicTask[]>([]);
  const [selectedPeriodicTaskId, setSelectedPeriodicTaskId] = useState<string | null>(
    null
  );
  const [isNewConversationModalOpen, setIsNewConversationModalOpen] = useState(false);
  const [isPeriodicTaskModalOpen, setIsPeriodicTaskModalOpen] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateInfo | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState(
    () => window.localStorage.getItem(UPDATE_DISMISSED_STORAGE_KEY) ?? ""
  );
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const relaySocketRef = useRef<WebSocket | null>(null);
  const relayReconnectTimerRef = useRef<number | null>(null);
  const relayConnectionGenerationRef = useRef(0);
  const relayReconnectAttemptRef = useRef(0);
  const relayConnectedAtRef = useRef<number | null>(null);
  const relayCommandHandlerRef = useRef<(data: unknown) => void>(() => undefined);
  const pendingReliableRelayEventsRef = useRef<Record<string, RelayEnvelope>>({});
  const previousHistoryScrollHeight = useRef(0);
  const lastPasteEventAt = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const completionRequestRef = useRef(0);
  const activeSessionIdRef = useRef<string | null>(session?.threadId ?? null);
  const activeSessionRef = useRef<SessionView | null>(session);
  const activeWorkspaceRef = useRef<string | null>(workspace);
  const workspaceSessionsRef = useRef<Record<string, SessionView[]>>(workspaceSessions);
  const sessionRefreshPromisesRef = useRef<Record<string, Promise<SessionView[]>>>({});
  const sessionsLoadingCountRef = useRef(0);
  const hiddenSessionIdsRef = useRef<Set<string>>(hiddenSessionIds);
  const runningTurnsBySessionRef = useRef<Record<string, string>>(runningTurnsBySession);
  const queuedRemoteTurnsRef = useRef<Record<string, QueuedRemoteTurn[]>>({});
  const turnStartedAtBySessionRef = useRef<Record<string, number>>({});
  const turnAssistantTextRef = useRef<
    Record<string, { turnId: string; text: string; createdAt: number }>
  >({});
  const reliableSnapshotRevisionRef = useRef(0);
  const latestDesktopSnapshotRef = useRef<unknown>(null);
  const desktopSnapshotTimerRef = useRef<number | null>(null);
  const reliableSnapshotTimerRef = useRef<number | null>(null);
  const relayProgressTimerRef = useRef<number | null>(null);
  const pendingRelayProgressRef = useRef<Record<string, RelayProgressPayload>>({});
  const transcriptFlushTimerRef = useRef<number | null>(null);
  const pendingTranscriptUpdatersRef = useRef<TranscriptUpdater[]>([]);
  const lastReliableSnapshotSignatureRef = useRef("");
  const processedClientCommandIdsRef = useRef<Set<string>>(
    new Set(readStringList(CLIENT_COMMAND_IDS_STORAGE_KEY))
  );
  const [status, setStatus] = useState(() =>
    DEMO_MODE
      ? "Demo layout fixture."
      : readSavedWorkspaces().length > 0
        ? "Restored previous workspaces."
        : "Add a workspace to begin."
  );
  const sessions = workspace ? workspaceSessions[workspace] ?? [] : [];
  const activeTurnId = session
    ? runningTurnsBySession[session.threadId] ?? null
    : null;
  const t = useMemo(
    () => (key: UIMessageKey, values?: Record<string, string | number>) =>
      textFor(language, key, values),
    [language]
  );
  const modelSelectOptions = modelOptions.some(option => option.id === model)
    ? modelOptions
    : [{ id: model, label: model }, ...modelOptions];
  const workspaceSessionEntries = workspaces.flatMap(cwd =>
    (workspaceSessions[cwd] ?? []).map(item => ({ workspace: cwd, session: item }))
  );
  const recentSessions = [...workspaceSessionEntries].sort(
    (left, right) => (right.session.updatedAt ?? 0) - (left.session.updatedAt ?? 0)
  );

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  const isRelayConfigured = relayEndpoint.trim().length > 0 && relayApiKey.trim().length > 0;
  const relayRetrySeconds = relayRetryDelayMs
    ? Math.max(1, Math.ceil(relayRetryDelayMs / 1000))
    : 1;
  const relayStatusMessage = !isRelayConfigured
    ? t("relayMissing")
    : relayState === "connected"
      ? relayPresence
        ? relayPresence.clientCount > 0
          ? t("mobileClientsOnline", { count: relayPresence.clientCount })
          : t("noMobileClientsOnline")
        : t("relayConnected")
      : relayState === "retrying"
        ? t("relayRetrying", { seconds: relayRetrySeconds })
        : relayState === "auth_error"
          ? t("relayAuthError")
          : relayState === "connecting"
            ? t("relayConnecting")
            : relayError || t("relayConnectionError");
  const relayStatusTooltip = `${t("relay")}: ${relayState}. ${relayStatusMessage}`;
  const RelayStatusIcon =
    relayState === "connected" || relayState === "connecting" ? Wifi : WifiOff;
  const visibleDesktopUpdate =
    desktopUpdate?.updateAvailable &&
    (desktopUpdate.downloadedPath || desktopUpdate.downloadUrl || desktopUpdate.releaseUrl) &&
    desktopUpdate.latestVersion !== dismissedUpdateVersion
      ? desktopUpdate
      : null;

  relayCommandHandlerRef.current = data => {
    void handleRelayMessage(data);
  };

  useEffect(() => {
    setSidebarTab("recent");
  }, []);

  useEffect(() => {
    if (DEMO_MODE) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      flushReliableRelayEvents();
    }, RELIABLE_RELAY_RETRY_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(
    () => () => {
      if (reliableSnapshotTimerRef.current !== null) {
        window.clearTimeout(reliableSnapshotTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    activeSessionIdRef.current = session?.threadId ?? null;
    activeSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    activeWorkspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    workspaceSessionsRef.current = workspaceSessions;
  }, [workspaceSessions]);

  useEffect(() => {
    hiddenSessionIdsRef.current = hiddenSessionIds;
  }, [hiddenSessionIds]);

  useEffect(() => {
    runningTurnsBySessionRef.current = runningTurnsBySession;
  }, [runningTurnsBySession]);

  useEffect(() => {
    turnStartedAtBySessionRef.current = turnStartedAtBySession;
  }, [turnStartedAtBySession]);

  useEffect(() => {
    if (DEMO_MODE || !desktopApi) {
      return undefined;
    }

    let disposed = false;
    void desktopApi.listPeriodicTasks().then(tasks => {
      if (!disposed) {
        setPeriodicTasks(tasks);
      }
    }).catch(error => {
      if (!disposed) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    });

    const unsubscribe = desktopApi.onPeriodicTasksUpdated(tasks => {
      setPeriodicTasks(tasks);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [desktopApi]);

  useEffect(() => {
    if (DEMO_MODE || !desktopUpdate) {
      return;
    }
    scheduleDesktopSnapshot();
    scheduleReliableDesktopSnapshot();
  }, [desktopUpdate]);

  useEffect(() => {
    if (DEMO_MODE || !desktopApi) {
      return undefined;
    }

    let disposed = false;
    const check = () => {
      void desktopApi.checkForUpdates()
      .then(info => {
        if (!disposed && info.updateAvailable) {
          setDesktopUpdate(info);
          setIsUpdateDialogOpen(true);
        }
      })
      .catch(() => {
        // Update checks should not interrupt the local workflow.
      });
    };

    check();
    const interval = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [desktopApi]);

  useEffect(() => {
    if (Object.keys(runningTurnsBySession).length === 0) {
      return undefined;
    }

    setTimerNow(Date.now());
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [runningTurnsBySession]);

  function isActiveEventThread(threadId: string | null | undefined) {
    return Boolean(threadId && activeSessionIdRef.current === threadId);
  }

  function markSessionTurnRunning(threadId: string, turnId: string) {
    if (!threadId || !turnId) {
      return;
    }
    setRunningTurnsBySession(previous => {
      const next = {
        ...previous,
        [threadId]: turnId
      };
      runningTurnsBySessionRef.current = next;
      return next;
    });
    if (!turnStartedAtBySessionRef.current[threadId]) {
      const next = {
        ...turnStartedAtBySessionRef.current,
        [threadId]: Date.now()
      };
      turnStartedAtBySessionRef.current = next;
      setTurnStartedAtBySession(next);
    }
  }

  function clearSessionTurnRunning(threadId: string) {
    if (!threadId) {
      return;
    }

    const startedAt = turnStartedAtBySessionRef.current[threadId];
    if (startedAt) {
      setLastTurnDurationBySession(previous => ({
        ...previous,
        [threadId]: Math.max(Date.now() - startedAt, 0)
      }));
      const nextStartedAt = { ...turnStartedAtBySessionRef.current };
      delete nextStartedAt[threadId];
      turnStartedAtBySessionRef.current = nextStartedAt;
      setTurnStartedAtBySession(nextStartedAt);
    }

    setRunningTurnsBySession(previous => {
      if (!previous[threadId]) {
        return previous;
      }
      const next = { ...previous };
      delete next[threadId];
      runningTurnsBySessionRef.current = next;
      return next;
    });
  }

  function enqueueRemoteTurn(threadId: string, turn: QueuedRemoteTurn) {
    const queue = queuedRemoteTurnsRef.current[threadId] ?? [];
    queuedRemoteTurnsRef.current = {
      ...queuedRemoteTurnsRef.current,
      [threadId]: [...queue, turn]
    };
    setStatus("Mobile message queued until the current turn completes.");
  }

  function shiftQueuedRemoteTurn(threadId: string): QueuedRemoteTurn | null {
    const queue = queuedRemoteTurnsRef.current[threadId] ?? [];
    const [nextTurn, ...remaining] = queue;
    if (!nextTurn) {
      return null;
    }

    if (remaining.length > 0) {
      queuedRemoteTurnsRef.current = {
        ...queuedRemoteTurnsRef.current,
        [threadId]: remaining
      };
    } else {
      const nextQueues = { ...queuedRemoteTurnsRef.current };
      delete nextQueues[threadId];
      queuedRemoteTurnsRef.current = nextQueues;
    }
    return nextTurn;
  }

  function sendNextQueuedRemoteTurn(threadId: string) {
    const queuedTurn = shiftQueuedRemoteTurn(threadId);
    if (!queuedTurn) {
      return;
    }
    setStatus("Sending queued mobile message.");
    void sendTurnRequest(
      queuedTurn.text,
      queuedTurn.attachments,
      queuedTurn.session,
      { clearLocalComposer: false }
    );
  }

  function updateTranscriptForActiveThread(
    threadId: string | null | undefined,
    updater: TranscriptUpdater
  ) {
    if (!isActiveEventThread(threadId)) {
      return;
    }
    flushPendingTranscriptUpdates();
    setTranscript(previous => {
      const next = updater(previous);
      transcriptRef.current = next;
      return next;
    });
    requestScrollToBottom();
  }

  function scheduleTranscriptUpdateForActiveThread(
    threadId: string | null | undefined,
    updater: TranscriptUpdater
  ) {
    if (!isActiveEventThread(threadId)) {
      return;
    }

    pendingTranscriptUpdatersRef.current = [
      ...pendingTranscriptUpdatersRef.current,
      updater
    ];
    if (transcriptFlushTimerRef.current !== null) {
      return;
    }

    transcriptFlushTimerRef.current = window.setTimeout(() => {
      transcriptFlushTimerRef.current = null;
      flushPendingTranscriptUpdates();
    }, STREAM_TRANSCRIPT_FLUSH_MS);
  }

  function flushPendingTranscriptUpdates() {
    const updaters = pendingTranscriptUpdatersRef.current;
    if (updaters.length === 0) {
      return;
    }
    pendingTranscriptUpdatersRef.current = [];

    setTranscript(previous => {
      const next = updaters.reduce(
        (current, updater) => updater(current),
        previous
      );
      transcriptRef.current = next;
      return next;
    });
    requestScrollToBottom();
  }

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (DEMO_MODE) {
      return undefined;
    }

    if (!desktopApi) {
      setStatus("Electron preload API is not available.");
      return undefined;
    }

    return desktopApi.onEvent(event => {
      if (!isHighFrequencyRelayEvent(event)) {
        publishRelay({
          type: "desktop.event",
          payload: { event: relayEventFromCodexEvent(event) }
        });
      }

      if (event.type === "turn.started") {
        markSessionTurnRunning(event.threadId, event.turnId);
        turnAssistantTextRef.current[event.threadId] = {
          turnId: event.turnId,
          text: "",
          createdAt: Date.now()
        };
        updateTranscriptForActiveThread(event.threadId, previous => [
          ...previous,
          {
            id: `turn-started-${event.turnId}`,
            role: "turn",
            text: "Turn started",
            meta: event.turnId.slice(0, 8)
          }
        ]);
        if (isActiveEventThread(event.threadId)) {
          setStatus("Codex is working.");
        }
      }

      if (event.type === "message.delta") {
        appendTurnAssistantText(event.threadId, event.turnId, event.text);
        scheduleRelayProgress(event.threadId, {
          sessionId: event.threadId,
          turnId: event.turnId,
          isWorking: true,
          message: relayAssistantProgressMessage(event.threadId, event.turnId)
        });
        scheduleTranscriptUpdateForActiveThread(event.threadId, previous =>
          appendAssistantDelta(previous, event.text)
        );
      }

      if (event.type === "command.delta") {
        const id = event.itemId ?? `${event.stream}-${event.turnId}`;
        scheduleTranscriptUpdateForActiveThread(event.threadId, previous =>
          appendCommandTimelineDelta(previous, id, event.stream, event.text)
        );
      }

      if (event.type === "plan.updated") {
        updateTranscriptForActiveThread(event.threadId, previous =>
          upsertTimelineEvent(previous, {
            id: `plan-${event.turnId}`,
            role: "plan",
            text: planSummary(event.plan),
            meta: event.turnId.slice(0, 8)
          })
        );
      }

      if (event.type === "diff.updated" || event.type === "file.patch.updated") {
        const value = event.type === "diff.updated" ? event.diff : event.patch;
        updateTranscriptForActiveThread(event.threadId, previous =>
          upsertTimelineEvent(previous, {
            id: `diff-${event.turnId}`,
            role: event.type === "file.patch.updated" ? "edited" : "diff",
            text:
              event.type === "file.patch.updated"
                ? editedSummary(value)
                : diffSummary(value),
            meta: event.turnId.slice(0, 8)
          })
        );
      }

      if (event.type === "approval.requested") {
        setApprovals(previous => [
          {
            id: event.requestId,
            type: event.approvalType,
            threadId: event.threadId,
            turnId: event.turnId,
            itemId: event.itemId,
            request: event.request,
            raw: event
          },
          ...previous.filter(item => item.id !== event.requestId)
        ]);
        updateTranscriptForActiveThread(event.threadId, previous =>
          upsertTimelineEvent(previous, {
            id: `approval-${String(event.requestId)}`,
            role: "approval",
            text: approvalSummary(event.request),
            meta: event.approvalType
          })
        );
        if (isActiveEventThread(event.threadId)) {
          setStatus("Approval requested.");
        }
      }

      if (event.type === "raw.notification") {
        const rawThreadId = threadIdFromRawNotification(event);
        if (!rawThreadId || isActiveEventThread(rawThreadId)) {
          updateRuntimeStateFromRawNotification(event);
        }
        const entry = timelineEntryFromRawNotification(event);
        if (entry && isActiveEventThread(rawThreadId)) {
          updateTranscriptForActiveThread(rawThreadId, previous =>
            upsertTimelineEvent(previous, entry)
          );
        }
      }

      if (event.type === "turn.completed") {
        flushPendingTranscriptUpdates();
        flushRelayProgress();
        clearSessionTurnRunning(event.threadId);
        handleTurnCompletedReminder(event.threadId);
        publishTurnCompletedEvent(event);
        const activeWorkspace = activeWorkspaceRef.current;
        const activeSession = activeSessionRef.current;
        if (activeWorkspace && activeSession?.threadId === event.threadId) {
          void refreshSessions(activeWorkspace, { preserveSession: activeSession });
        }
        void refreshRateLimitUsage();
        if (isActiveEventThread(event.threadId)) {
          setStatus("Turn completed.");
        }
        sendNextQueuedRemoteTurn(event.threadId);
      }
    });
  }, [
    desktopApi,
    notificationSoundFile?.url,
    soundNotificationsEnabled
  ]);

  function updateRuntimeStateFromRawNotification(
    event: Extract<CodexAdapterEvent, { type: "raw.notification" }>
  ) {
    const rateLimits = rateLimitUsageFromUnknown(event.raw.params);
    if (rateLimits) {
      setRateLimitUsage(rateLimits);
    }

    if (event.method === "thread/tokenUsage/updated") {
      const usage = contextUsageFromNotification(event.raw.params);
      if (usage) {
        setContextUsage(usage);
      }
      return;
    }

    if (event.method === "thread/settings/updated") {
      const settings = asRecord(asRecord(event.raw.params).threadSettings);
      const nextModel = stringOrUndefined(settings.model);
      const nextEffort = stringOrUndefined(settings.effort);
      if (nextModel) {
        setModel(nextModel);
        window.localStorage.setItem(MODEL_STORAGE_KEY, nextModel);
      }
      if (isModelEffort(nextEffort)) {
        setModelEffort(nextEffort);
        window.localStorage.setItem(MODEL_EFFORT_STORAGE_KEY, nextEffort);
      }
    }
  }

  useEffect(() => {
    if (DEMO_MODE) {
      return undefined;
    }

    relayConnectionGenerationRef.current += 1;
    const generation = relayConnectionGenerationRef.current;
    const endpoint = relayEndpoint.trim();
    const apiKey = relayApiKey.trim();
    let disposed = false;
    let socket: WebSocket | null = null;

    const clearReconnectTimer = () => {
      if (relayReconnectTimerRef.current !== null) {
        window.clearTimeout(relayReconnectTimerRef.current);
        relayReconnectTimerRef.current = null;
      }
    };

    const isCurrentConnection = () =>
      !disposed && relayConnectionGenerationRef.current === generation;

    const closeCurrentSocket = () => {
      if (socket && relaySocketRef.current === socket) {
        relaySocketRef.current = null;
      }
      socket?.close();
      socket = null;
    };

    const scheduleReconnect = (reason: string) => {
      if (!isCurrentConnection()) {
        return;
      }

      clearReconnectTimer();
      closeCurrentSocket();

      const attempt = relayReconnectAttemptRef.current;
      const baseDelay =
        RELAY_RECONNECT_DELAYS_MS[Math.min(attempt, RELAY_RECONNECT_DELAYS_MS.length - 1)];
      const jitter = Math.floor(Math.random() * RELAY_RECONNECT_JITTER_MS);
      const delay = baseDelay + jitter;

      relayReconnectAttemptRef.current = attempt + 1;
      setRelayState("retrying");
      setRelayError(reason);
      setRelayRetryDelayMs(delay);
      relayReconnectTimerRef.current = window.setTimeout(() => {
        relayReconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!isCurrentConnection()) {
        return;
      }

      clearReconnectTimer();
      closeCurrentSocket();
      setRelayState("connecting");
      setRelayError("");
      setRelayRetryDelayMs(null);

      let relayURL: string;
      try {
        relayURL = relayWebSocketURL(endpoint, "desktop", deviceId, apiKey);
        socket = new WebSocket(relayURL);
      } catch {
        setRelayState("error");
        setRelayError("Relay endpoint is not a valid WebSocket URL.");
        return;
      }

      const activeSocket = socket;
      relaySocketRef.current = activeSocket;

      activeSocket.addEventListener("open", () => {
        if (!isCurrentConnection() || relaySocketRef.current !== activeSocket) {
          activeSocket.close();
          return;
        }
        relayConnectedAtRef.current = Date.now();
        setRelayState("connected");
        setRelayError("");
        setRelayRetryDelayMs(null);
        setRelayPresence(null);
        publishDesktopSnapshot();
        flushReliableRelayEvents();
      });
      activeSocket.addEventListener("message", event => {
        if (!isCurrentConnection() || relaySocketRef.current !== activeSocket) {
          return;
        }
        relayCommandHandlerRef.current(event.data);
      });
      activeSocket.addEventListener("close", event => {
        if (!isCurrentConnection() || relaySocketRef.current !== activeSocket) {
          return;
        }
        relaySocketRef.current = null;
        setRelayPresence(null);
        const connectedAt = relayConnectedAtRef.current;
        relayConnectedAtRef.current = null;
        if (connectedAt && Date.now() - connectedAt >= RELAY_STABLE_CONNECTION_MS) {
          relayReconnectAttemptRef.current = 0;
        }
        if (event.code === 1008 || event.code === 4401 || event.code === 4403) {
          setRelayState("auth_error");
          setRelayError("Relay authentication failed.");
          setRelayRetryDelayMs(null);
          return;
        }
        const reason = event.code
          ? `Relay connection closed with code ${event.code}.`
          : "Relay connection closed.";
        scheduleReconnect(reason);
      });
      activeSocket.addEventListener("error", () => {
        if (!isCurrentConnection() || relaySocketRef.current !== activeSocket) {
          return;
        }
        setRelayState("error");
        setRelayError("Relay WebSocket error.");
      });
    };

    const reconnectNow = () => {
      if (!isCurrentConnection()) {
        return;
      }
      const currentSocket = relaySocketRef.current;
      if (
        currentSocket?.readyState === WebSocket.OPEN ||
        currentSocket?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
      relayReconnectAttemptRef.current = 0;
      connect();
    };

    clearReconnectTimer();
    closeCurrentSocket();
    relayReconnectAttemptRef.current = 0;
    relayConnectedAtRef.current = null;
    setRelayRetryDelayMs(null);

    if (!endpoint || !apiKey) {
      setRelayState("disabled");
      setRelayError("");
      setRelayPresence(null);
      return undefined;
    }

    window.addEventListener("online", reconnectNow);
    window.addEventListener("focus", reconnectNow);
    connect();

    return () => {
      disposed = true;
      window.removeEventListener("online", reconnectNow);
      window.removeEventListener("focus", reconnectNow);
      clearReconnectTimer();
      closeCurrentSocket();
      setRelayPresence(null);
    };
  }, [deviceId, relayApiKey, relayEndpoint]);

  useEffect(() => {
    latestDesktopSnapshotRef.current = buildDesktopSnapshotPayload();
    scheduleDesktopSnapshot();
    scheduleReliableDesktopSnapshot();
  }, [
    approvals,
    connectionState,
    contextUsage,
    model,
    modelEffort,
    permissionMode,
    rateLimitUsage,
    relayState,
    periodicTasks,
    runningTurnsBySession,
    session,
    sessions,
    status,
    unreadSessionIds,
    lastTurnDurationBySession,
    modelOptions,
    workspace,
    workspaceSessions,
    workspaces
  ]);

  useEffect(() => {
    return () => {
      if (desktopSnapshotTimerRef.current !== null) {
        window.clearTimeout(desktopSnapshotTimerRef.current);
      }
      if (reliableSnapshotTimerRef.current !== null) {
        window.clearTimeout(reliableSnapshotTimerRef.current);
      }
      if (relayProgressTimerRef.current !== null) {
        window.clearTimeout(relayProgressTimerRef.current);
      }
      if (transcriptFlushTimerRef.current !== null) {
        window.clearTimeout(transcriptFlushTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (scrollRequest === 0) {
      return undefined;
    }

    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const element = messagesRef.current;
        if (element) {
          element.scrollTop = element.scrollHeight;
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [scrollRequest, session?.threadId, transcript.length]);

  useEffect(() => {
    if (historyLoadRequest === 0) {
      return undefined;
    }

    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const element = messagesRef.current;
        if (!element) {
          return;
        }

        const heightDelta = element.scrollHeight - previousHistoryScrollHeight.current;
        element.scrollTop += heightDelta;
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [historyLoadRequest]);

  useEffect(() => {
    if (DEMO_MODE) {
      return;
    }

    if (!desktopApi || connectionState !== "disconnected") {
      return;
    }

    void connect();
  }, [connectionState, desktopApi]);

  useEffect(() => {
    if (DEMO_MODE || connectionState !== "connected") {
      return;
    }
    void refreshModelOptions();
  }, [connectionState, desktopApi]);

  useEffect(() => {
    if (DEMO_MODE || connectionState !== "connected") {
      return undefined;
    }

    void refreshRateLimitUsage();
    const interval = window.setInterval(() => {
      void refreshRateLimitUsage();
    }, RATE_LIMIT_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [connectionState, desktopApi]);

  useEffect(() => {
    if (!activeTurnId) {
      return undefined;
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      void interruptTurn();
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [activeTurnId, desktopApi, session?.threadId]);

  useEffect(() => {
    if (DEMO_MODE) {
      return;
    }

    if (workspaces.length === 0 || !desktopApi || connectionState !== "connected") {
      return;
    }

    const activeWorkspace = workspace ?? workspaces[0] ?? null;
    if (activeWorkspace) {
      void refreshSessions(activeWorkspace, {
        openPreferred: activeWorkspace === workspace && activeSessionRef.current === null
      });
    }

    const timers = workspaces
      .filter(cwd => cwd !== activeWorkspace)
      .map((cwd, index) =>
        window.setTimeout(() => {
          void refreshSessions(cwd, { openPreferred: false });
        }, BACKGROUND_SESSION_REFRESH_DELAY_MS * (index + 1))
      );

    return () => {
      timers.forEach(timer => window.clearTimeout(timer));
    };
  }, [connectionState, desktopApi, workspace, workspaces]);

  useEffect(() => {
    function clearActiveUnreadWhenFocused() {
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        activeSessionIdRef.current
      ) {
        clearSessionUnread(activeSessionIdRef.current);
      }
    }

    window.addEventListener("focus", clearActiveUnreadWhenFocused);
    document.addEventListener("visibilitychange", clearActiveUnreadWhenFocused);
    return () => {
      window.removeEventListener("focus", clearActiveUnreadWhenFocused);
      document.removeEventListener("visibilitychange", clearActiveUnreadWhenFocused);
    };
  }, []);

  useEffect(() => {
    if (!composerCompletion || !desktopApi || !session) {
      return undefined;
    }

    const requestId = completionRequestRef.current + 1;
    completionRequestRef.current = requestId;
    const { mode, query } = composerCompletion;
    const timer = window.setTimeout(() => {
      const search =
        mode === "file" && workspace
          ? desktopApi.searchWorkspaceFiles({ cwd: workspace, query, limit: 36 })
          : mode === "skill"
            ? desktopApi.searchSkills({ cwd: workspace ?? undefined, query, limit: 36 })
            : Promise.resolve([]);

      void search
        .then(items => {
          if (completionRequestRef.current !== requestId) {
            return;
          }
          setComposerCompletion(current => {
            if (!current || current.mode !== mode || current.query !== query) {
              return current;
            }
            return {
              ...current,
              items,
              selectedIndex: Math.min(current.selectedIndex, Math.max(items.length - 1, 0)),
              loading: false
            };
          });
        })
        .catch(error => {
          if (completionRequestRef.current !== requestId) {
            return;
          }
          setComposerCompletion(current =>
            current && current.mode === mode && current.query === query
              ? { ...current, items: [], selectedIndex: 0, loading: false }
              : current
          );
          setStatus(error instanceof Error ? error.message : String(error));
        });
    }, 90);

    return () => window.clearTimeout(timer);
  }, [
    composerCompletion?.mode,
    composerCompletion?.query,
    desktopApi,
    session?.threadId,
    workspace
  ]);

  const isTurnRunning = activeTurnId !== null;
  const isConversationLoading =
    isSessionOpening && session !== null && transcript.length === 0;
  const activeTurnStartedAt = session
    ? turnStartedAtBySession[session.threadId] ?? null
    : null;
  const activeTurnElapsedMs =
    isTurnRunning && activeTurnStartedAt
      ? Math.max(timerNow - activeTurnStartedAt, 0)
      : null;
  const activeLastTurnDurationMs = session
    ? lastTurnDurationBySession[session.threadId] ?? null
    : null;
  const visibleTurnDurationMs = activeTurnElapsedMs ?? activeLastTurnDurationMs;
  const canSubmit =
    connectionState === "connected" &&
    session !== null &&
    (composer.trim().length > 0 || attachments.length > 0);
  const hiddenTranscriptCount = Math.max(
    transcript.length - visibleTranscriptCount,
    0
  );
  const visibleTranscript = useMemo(
    () => transcript.slice(hiddenTranscriptCount),
    [hiddenTranscriptCount, transcript]
  );

  const shortWorkspace = useMemo(() => {
    if (!workspace) {
      return "No workspace";
    }
    const parts = workspace.split("/");
    return parts.at(-1) || workspace;
  }, [workspace]);

  function requestScrollToBottom() {
    setScrollRequest(previous => previous + 1);
  }

  function resetVisibleTranscriptWindow() {
    setVisibleTranscriptCount(INITIAL_VISIBLE_TRANSCRIPT_COUNT);
  }

  function loadOlderTranscript() {
    const element = messagesRef.current;
    previousHistoryScrollHeight.current = element?.scrollHeight ?? 0;
    setVisibleTranscriptCount(previous =>
      Math.min(previous + TRANSCRIPT_PAGE_SIZE, transcript.length)
    );
    setHistoryLoadRequest(previous => previous + 1);
  }

  async function chooseWorkspace() {
    if (!desktopApi) {
      return;
    }

    const selected = await desktopApi.chooseWorkspace();
    if (selected) {
      const nextWorkspaces = upsertWorkspace(workspaces, selected);
      setWorkspaces(nextWorkspaces);
      saveWorkspaces(nextWorkspaces);
      selectWorkspace(selected);
      setStatus("Workspace added. Loading sessions.");
      if (connectionState === "connected") {
        void refreshSessions(selected, { openPreferred: true });
      }
    }
  }

  function selectWorkspace(cwd: string) {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, cwd);
    setWorkspace(cwd);
    const workspaceHasCurrentSession =
      session !== null &&
      (workspaceSessions[cwd] ?? []).some(item => item.threadId === session.threadId);
    if (!workspaceHasCurrentSession) {
      setSession(null);
      setTranscript([]);
      resetVisibleTranscriptWindow();
      setAttachments([]);
      setApprovals([]);
      setStatus(`Selected workspace ${workspaceName(cwd)}.`);
    }
    if (connectionState === "connected") {
      void refreshSessions(cwd, { openPreferred: false });
    }
  }

  function toggleWorkspaceCollapsed(cwd: string) {
    setCollapsedWorkspaces(previous => {
      const next = new Set(previous);
      if (next.has(cwd)) {
        next.delete(cwd);
      } else {
        next.add(cwd);
      }
      saveStringList(COLLAPSED_WORKSPACES_STORAGE_KEY, Array.from(next));
      return next;
    });
  }

  function removeWorkspace(cwd: string, options: { confirm?: boolean } = {}) {
    const workspaceLabel = workspaceName(cwd);
    if (
      options.confirm !== false &&
      !window.confirm(
        `Remove ${workspaceLabel} from Codex+? Codex session history on disk will not be deleted.`
      )
    ) {
      return;
    }

    const removedSessionIds = new Set(
      (workspaceSessions[cwd] ?? []).map(item => item.threadId)
    );
    const nextWorkspaces = workspaces.filter(item => item !== cwd);
    setWorkspaces(nextWorkspaces);
    saveWorkspaces(nextWorkspaces);
    setWorkspaceSessions(previous => {
      const next = { ...previous };
      delete next[cwd];
      workspaceSessionsRef.current = next;
      writeCachedWorkspaceSessions(next);
      return next;
    });
    saveStringMap(
      SESSION_TITLE_OVERRIDES_STORAGE_KEY,
      Object.fromEntries(
        Object.entries(readStringMap(SESSION_TITLE_OVERRIDES_STORAGE_KEY)).filter(
          ([threadId]) => !removedSessionIds.has(threadId)
        )
      )
    );
    setRunningTurnsBySession(previous =>
      Object.fromEntries(
        Object.entries(previous).filter(([threadId]) => !removedSessionIds.has(threadId))
      )
    );
    setCollapsedWorkspaces(previous => {
      const next = new Set(previous);
      next.delete(cwd);
      saveStringList(COLLAPSED_WORKSPACES_STORAGE_KEY, Array.from(next));
      return next;
    });

    if (workspace === cwd) {
      const nextWorkspace = nextWorkspaces[0] ?? null;
      setWorkspace(nextWorkspace);
      if (nextWorkspace) {
        window.localStorage.setItem(WORKSPACE_STORAGE_KEY, nextWorkspace);
      } else {
        window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      }
      setSession(null);
      setTranscript([]);
      resetVisibleTranscriptWindow();
      setAttachments([]);
      setApprovals([]);
    }

    setStatus(`Removed workspace ${workspaceLabel} from the sidebar.`);
  }

  function removeSession(cwd: string, target: SessionView, options: { confirm?: boolean } = {}) {
    const sessionLabel = target.title || target.threadId.slice(0, 8);
    if (
      options.confirm !== false &&
      !window.confirm(t("removeSessionConfirm", { title: sessionLabel }))
    ) {
      return;
    }

    setHiddenSessionIds(previous => {
      const next = new Set(previous);
      next.add(target.threadId);
      hiddenSessionIdsRef.current = next;
      saveStringList(HIDDEN_SESSIONS_STORAGE_KEY, Array.from(next));
      return next;
    });
    setWorkspaceSessions(previous => {
      const next = {
        ...previous,
        [cwd]: (previous[cwd] ?? []).filter(item => item.threadId !== target.threadId)
      };
      workspaceSessionsRef.current = next;
      writeCachedWorkspaceSessions(next);
      return next;
    });
    setUnreadSessionIds(previous => {
      if (!previous.has(target.threadId)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(target.threadId);
      saveStringList(UNREAD_SESSIONS_STORAGE_KEY, Array.from(next));
      return next;
    });
    setRunningTurnsBySession(previous =>
      Object.fromEntries(
        Object.entries(previous).filter(([threadId]) => threadId !== target.threadId)
      )
    );
    setTurnStartedAtBySession(previous =>
      Object.fromEntries(
        Object.entries(previous).filter(([threadId]) => threadId !== target.threadId)
      )
    );
    setLastTurnDurationBySession(previous =>
      Object.fromEntries(
        Object.entries(previous).filter(([threadId]) => threadId !== target.threadId)
      )
    );
    removeSavedSession(cwd, target.threadId);

    if (workspace === cwd && session?.threadId === target.threadId) {
      setSession(null);
      setTranscript([]);
      resetVisibleTranscriptWindow();
      setAttachments([]);
      setApprovals([]);
    }

    setStatus("Session removed from the list. Codex history on disk was not deleted.");
  }

  async function renameSession(cwd: string, target: SessionView, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === target.title) {
      return;
    }

    try {
      await renameSessionTo(cwd, target, nextTitle, { prompt: true });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function renameSessionTo(
    cwd: string,
    target: SessionView,
    nextTitle: string,
    options: { prompt: boolean }
  ) {
    if (!DEMO_MODE && desktopApi) {
      await desktopApi.renameThread({
        threadId: target.threadId,
        name: nextTitle
      });
    }

    const renamedSession = { ...target, title: nextTitle };
    saveStringMap(SESSION_TITLE_OVERRIDES_STORAGE_KEY, {
      ...readStringMap(SESSION_TITLE_OVERRIDES_STORAGE_KEY),
      [target.threadId]: nextTitle
    });
    setWorkspaceSessions(previous => {
      const next = {
        ...previous,
        [cwd]: (previous[cwd] ?? []).map(item =>
          item.threadId === target.threadId ? renamedSession : item
        )
      };
      workspaceSessionsRef.current = next;
      writeCachedWorkspaceSessions(next);
      return next;
    });

    if (session?.threadId === target.threadId) {
      setSession(renamedSession);
      saveSession(cwd, renamedSession);
      setStatus("Session renamed.");
    } else {
      setStatus(
        options.prompt
          ? "Session renamed."
          : "Session renamed from mobile."
      );
    }
  }

  async function connect() {
    if (!desktopApi) {
      return;
    }

    setConnectionState("connecting");
    setStatus("Starting local Codex app-server.");
    try {
      const response = await desktopApi.connect();
      setConnectionState("connected");
      setStatus(`Connected: ${response.userAgent}`);
    } catch (error) {
      setConnectionState("disconnected");
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshModelOptions() {
    if (!desktopApi) {
      return;
    }

    try {
      const response = await desktopApi.listModels({ includeHidden: true, limit: 100 });
      const modelSummaries = modelListData(response);
      const options = modelSummaries
        .map(modelOptionFromSummary)
        .filter(option => option !== null);
      if (options.length > 0) {
        setModelOptions(options);
        const defaultModel = modelSummaries.find(item => item.isDefault);
        const defaultOption = defaultModel ? modelOptionFromSummary(defaultModel) : null;
        if (!window.localStorage.getItem(MODEL_STORAGE_KEY) && defaultOption) {
          updateModel(defaultOption.id);
        }
      }
    } catch {
      setModelOptions(FALLBACK_MODEL_OPTIONS);
    }
  }

  async function refreshRateLimitUsage() {
    if (!desktopApi) {
      return;
    }

    try {
      const response = await desktopApi.getStatus();
      const rateLimits = rateLimitUsageFromUnknown(response);
      if (rateLimits) {
        setRateLimitUsage(rateLimits);
      }
    } catch {
      // Older Codex app-server builds may not expose a status RPC. Keep the
      // last notification-derived values instead of surfacing a noisy error.
    }
  }

  function modelListData(response: unknown): Array<{
    id?: string;
    model?: string;
    slug?: string;
    displayName?: string;
    display_name?: string;
    isDefault?: boolean;
  }> {
    const record = response && typeof response === "object" ? response as Record<string, unknown> : {};
    if (Array.isArray(record.data)) {
      return record.data as Array<{
        id?: string;
        model?: string;
        slug?: string;
        displayName?: string;
        display_name?: string;
        isDefault?: boolean;
      }>;
    }
    if (Array.isArray(record.models)) {
      return record.models as Array<{
        id?: string;
        model?: string;
        slug?: string;
        displayName?: string;
        display_name?: string;
        isDefault?: boolean;
      }>;
    }
    return [];
  }

  function modelOptionFromSummary(item: {
    id?: string;
    model?: string;
    slug?: string;
    displayName?: string;
    display_name?: string;
  }): ModelOption | null {
    const id = item.id || item.model || item.slug;
    if (!id) {
      return null;
    }
    return {
      id,
      label: item.displayName || item.display_name || item.model || id
    };
  }

  async function startSession() {
    if (!workspace || !desktopApi) {
      return;
    }

    setMainView("conversation");
    setStatus("Creating Codex thread.");
    setIsSessionOpening(true);
    try {
      const savedSession = readSavedSession(workspace);
      const latestSession =
        sessions[0] ??
        (savedSession && !hiddenSessionIdsRef.current.has(savedSession.threadId)
          ? savedSession
          : null);
      const response = latestSession
        ? await desktopApi
            .resumeThread({
              threadId: latestSession.threadId,
              cwd: workspace,
              ...codexPermissionOptions(permissionMode),
              ...codexModelOptions(model, modelEffort)
            })
            .catch(() =>
              desktopApi.startThread({
                cwd: workspace,
                ...codexPermissionOptions(permissionMode),
                ...codexModelOptions(model, modelEffort)
              })
            )
        : await desktopApi.startThread({
            cwd: workspace,
            ...codexPermissionOptions(permissionMode),
            ...codexModelOptions(model, modelEffort)
          });
      applyRuntimeSettingsFromResponse(response);
      const titleOverrides = readStringMap(SESSION_TITLE_OVERRIDES_STORAGE_KEY);
      const nextSession = {
        threadId: response.thread.id,
        title: titleOverrides[response.thread.id] ?? response.thread.preview ?? shortWorkspace,
        updatedAt: response.thread.updatedAt
      };
      setSession(nextSession);
      clearSessionUnread(nextSession.threadId);
      saveSession(workspace, nextSession);
      setWorkspaceSessions(previous => {
        const next = {
          ...previous,
          [workspace]: upsertSession(previous[workspace] ?? [], nextSession)
        };
        workspaceSessionsRef.current = next;
        writeCachedWorkspaceSessions(next);
        return next;
      });
      resetVisibleTranscriptWindow();
      setTranscript([
        ...transcriptFromThread(response.thread),
        systemEntry(
          latestSession && response.thread.id === latestSession.threadId
            ? `Session resumed in ${workspace}`
            : `Session started in ${workspace}`
        )
      ]);
      requestScrollToBottom();
      setStatus(
        latestSession && response.thread.id === latestSession.threadId
          ? "Previous workspace session resumed."
          : "Session ready."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSessionOpening(false);
    }
  }

  async function startNewSession() {
    if (!workspace || !desktopApi || isSessionOpening) {
      return;
    }
    await startNewSessionForWorkspace(workspace);
  }

  async function startNewSessionForWorkspace(cwd: string) {
    if (!desktopApi || isSessionOpening) {
      return;
    }

    setMainView("conversation");
    setIsSessionOpening(true);
    setStatus("Creating new Codex session.");
    try {
      const response = await desktopApi.startThread({
        cwd,
        ...codexPermissionOptions(permissionMode),
        ...codexModelOptions(model, modelEffort)
      });
      applyRuntimeSettingsFromResponse(response);
      const nextSession = {
        threadId: response.thread.id,
        title: response.thread.preview || "New session",
        updatedAt: response.thread.updatedAt
      };
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, cwd);
      setWorkspace(cwd);
      setSession(nextSession);
      clearSessionUnread(nextSession.threadId);
      saveSession(cwd, nextSession);
      setWorkspaceSessions(previous => {
        const next = {
          ...previous,
          [cwd]: upsertSession(previous[cwd] ?? [], nextSession)
        };
        workspaceSessionsRef.current = next;
        writeCachedWorkspaceSessions(next);
        return next;
      });
      resetVisibleTranscriptWindow();
      setTranscript([
        systemEntry(`New session started in ${cwd}`)
      ]);
      requestScrollToBottom();
      setStatus("New session ready.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSessionOpening(false);
    }
  }

  function openNewConversationModal() {
    setIsNewConversationModalOpen(true);
  }

  function createConversationForWorkspace(cwd: string) {
    setIsNewConversationModalOpen(false);
    void startNewSessionForWorkspace(cwd);
  }

  async function openSession(target: SessionView, cwd = workspace) {
    if (!cwd || !desktopApi || isSessionOpening) {
      return;
    }

    setMainView("conversation");
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, cwd);
    setWorkspace(cwd);
    setSession(target);
    clearSessionUnread(target.threadId);
    resetVisibleTranscriptWindow();
    setTranscript([]);
    setAttachments([]);
    setApprovals([]);
    setIsSessionOpening(true);
    setStatus("Resuming session.");
    try {
      const response = await desktopApi.resumeThread({
        threadId: target.threadId,
        cwd,
        ...codexPermissionOptions(permissionMode),
        ...codexModelOptions(model, modelEffort)
      });
      applyRuntimeSettingsFromResponse(response);
      const titleOverrides = readStringMap(SESSION_TITLE_OVERRIDES_STORAGE_KEY);
      const nextSession = {
        threadId: response.thread.id,
        title:
          titleOverrides[response.thread.id] ??
          response.thread.preview ??
          target.title ??
          workspaceName(cwd),
        updatedAt: response.thread.updatedAt
      };
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, cwd);
      setWorkspace(cwd);
      setSession(nextSession);
      clearSessionUnread(nextSession.threadId);
      saveSession(cwd, nextSession);
      setWorkspaceSessions(previous => {
        const next = {
          ...previous,
          [cwd]: upsertSession(previous[cwd] ?? [], nextSession)
        };
        workspaceSessionsRef.current = next;
        writeCachedWorkspaceSessions(next);
        return next;
      });
      resetVisibleTranscriptWindow();
      setTranscript([
        ...transcriptFromThread(response.thread),
        systemEntry(`Session resumed in ${cwd}`)
      ]);
      requestScrollToBottom();
      const renameOverride = titleOverrides[response.thread.id];
      if (
        renameOverride &&
        response.thread.name !== renameOverride &&
        response.thread.preview !== renameOverride
      ) {
        await desktopApi.renameThread({
          threadId: response.thread.id,
          name: renameOverride
        });
        setStatus("Session resumed. Synced Codex rename.");
      } else {
        setStatus("Session resumed.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSessionOpening(false);
    }
  }

  async function refreshSessions(
    cwd: string,
    options: { openPreferred?: boolean; preserveSession?: SessionView | null } = {}
  ) {
    if (!desktopApi) {
      return;
    }

    try {
      const listedSessions = await listWorkspaceSessions(cwd);
      const preservedSession =
        options.preserveSession ??
        (cwd === activeWorkspaceRef.current ? activeSessionRef.current : null);
      const nextSessions =
        preservedSession &&
        !hiddenSessionIdsRef.current.has(preservedSession.threadId) &&
        !listedSessions.some(item => item.threadId === preservedSession.threadId)
          ? upsertSession(listedSessions, preservedSession)
          : listedSessions;
      setWorkspaceSessions(previous => {
        const next = {
          ...previous,
          [cwd]: nextSessions
        };
        workspaceSessionsRef.current = next;
        writeCachedWorkspaceSessions(next);
        return next;
      });

      if (options.openPreferred) {
        const savedSession = readSavedSession(cwd);
        const preferred =
          nextSessions.find(item => item.threadId === savedSession?.threadId) ??
          nextSessions[0];
        if (preferred) {
          void openSession(preferred, cwd);
        } else {
          void startNewSessionForWorkspace(cwd);
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function listWorkspaceSessions(cwd: string): Promise<SessionView[]> {
    if (!desktopApi) {
      return Promise.resolve([]);
    }

    const existing = sessionRefreshPromisesRef.current[cwd];
    if (existing) {
      return existing;
    }

    beginSessionsLoading();
    const promise = desktopApi.listThreads({ cwd })
      .then(response => {
        const titleOverrides = readStringMap(SESSION_TITLE_OVERRIDES_STORAGE_KEY);
        return response.data
          .map(thread => ({
            threadId: thread.id,
            title:
              titleOverrides[thread.id] ??
              thread.preview ??
              thread.name ??
              workspaceName(cwd),
            updatedAt: thread.updatedAt,
            status:
              typeof thread.status === "string"
                ? thread.status
                : JSON.stringify(thread.status)
          }))
          .filter(item => !hiddenSessionIdsRef.current.has(item.threadId));
      })
      .finally(() => {
        const next = { ...sessionRefreshPromisesRef.current };
        delete next[cwd];
        sessionRefreshPromisesRef.current = next;
        endSessionsLoading();
      });

    sessionRefreshPromisesRef.current = {
      ...sessionRefreshPromisesRef.current,
      [cwd]: promise
    };
    return promise;
  }

  function beginSessionsLoading() {
    sessionsLoadingCountRef.current += 1;
    setIsSessionsLoading(true);
  }

  function endSessionsLoading() {
    sessionsLoadingCountRef.current = Math.max(0, sessionsLoadingCountRef.current - 1);
    setIsSessionsLoading(sessionsLoadingCountRef.current > 0);
  }

  async function savePeriodicTask(
    input: PeriodicTaskInput,
    taskId?: string | null
  ) {
    if (!desktopApi) {
      return;
    }

    try {
      const task = taskId
        ? await desktopApi.updatePeriodicTask({ taskId, patch: input })
        : await desktopApi.createPeriodicTask(input);
      setSelectedPeriodicTaskId(task.id);
      setIsPeriodicTaskModalOpen(false);
      setStatus(t("taskSaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function togglePeriodicTask(task: PeriodicTask) {
    if (!desktopApi) {
      return;
    }

    try {
      await desktopApi.updatePeriodicTask({
        taskId: task.id,
        patch: { enabled: !task.enabled }
      });
      setStatus(!task.enabled ? t("resume") : t("pause"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function deletePeriodicTask(task: PeriodicTask) {
    if (!desktopApi) {
      return;
    }
    if (!window.confirm(`${t("deleteTask")}: ${task.name}?`)) {
      return;
    }

    try {
      await desktopApi.deletePeriodicTask({ taskId: task.id });
      setSelectedPeriodicTaskId(current => current === task.id ? null : current);
      setIsPeriodicTaskModalOpen(false);
      setStatus(t("taskDeleted"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function runPeriodicTaskNow(task: PeriodicTask) {
    if (!desktopApi) {
      return;
    }

    try {
      await desktopApi.runPeriodicTaskNow({ taskId: task.id });
      setStatus(t("taskStarted"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function openPeriodicTaskSession(task: PeriodicTask) {
    if (!task.sessionId) {
      return;
    }
    setMainView("conversation");
    void openSession(
      {
        threadId: task.sessionId,
        title: task.name,
        updatedAt: task.lastCompletedAt ?? task.lastRunAt ?? task.updatedAt
      },
      task.workspace
    );
  }

  function openNewPeriodicTaskModal() {
    setSelectedPeriodicTaskId(null);
    setSidebarTab("automations");
    setIsPeriodicTaskModalOpen(true);
  }

  function openPeriodicTaskModal(taskId: string) {
    setSelectedPeriodicTaskId(taskId);
    setSidebarTab("automations");
    setIsPeriodicTaskModalOpen(true);
  }

  async function sendTurn() {
    const text = composer.trim();
    const outgoingAttachments = attachments;
    await sendTurnRequest(text, outgoingAttachments);
  }

  async function sendTurnRequest(
    text: string,
    outgoingAttachments: ComposerAttachment[],
    targetSession: SessionView | null = session,
    options: { clearLocalComposer?: boolean } = {}
  ) {
    if (
      !desktopApi ||
      !targetSession ||
      (text.trim().length === 0 && outgoingAttachments.length === 0)
    ) {
      return;
    }

    const trimmedText = text.trim();
    const input = buildTurnInput(trimmedText, outgoingAttachments);
    const displayText = userTranscriptText(trimmedText, outgoingAttachments);
    if (options.clearLocalComposer ?? true) {
      setComposer("");
      setComposerCompletion(null);
      setAttachments([]);
    }
    resetVisibleTranscriptWindow();
    setTranscript(previous => [
      ...previous,
      { id: `user-${Date.now()}`, role: "user", text: displayText, createdAt: Date.now() }
    ]);
    requestScrollToBottom();
    setStatus("Sending turn.");

    try {
      const response = await desktopApi.startTurn({
        threadId: targetSession.threadId,
        text: trimmedText,
        input,
        ...codexPermissionOptions(permissionMode),
        ...codexModelOptions(model, modelEffort)
      });
      markSessionTurnRunning(targetSession.threadId, response.turn.id);
      requestScrollToBottom();
    } catch (error) {
      clearSessionTurnRunning(targetSession.threadId);
      if (options.clearLocalComposer ?? true) {
        setAttachments(outgoingAttachments);
      }
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function pasteAttachments(options: { quiet?: boolean } = {}) {
    if (!desktopApi) {
      return false;
    }

    try {
      const result = await desktopApi.readClipboardAttachments();
      const pastedAttachments = normalizeClipboardAttachmentResult(result);
      if (pastedAttachments.length === 0) {
        if (!options.quiet) {
          const formats = Array.isArray(result) ? "" : result.formats.join(", ");
          setStatus(
            formats
              ? `Clipboard has no readable image/file. Formats: ${formats}`
              : "Clipboard does not contain an image or file."
          );
        }
        return false;
      }

      addAttachments(pastedAttachments);
      setStatus(
        `Attached ${pastedAttachments.length} item${
          pastedAttachments.length === 1 ? "" : "s"
        } from clipboard.`
      );
      return true;
    } catch (error) {
      if (!options.quiet) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
      return false;
    }
  }

  async function chooseAttachmentFiles() {
    if (!desktopApi) {
      return;
    }

    try {
      const selectedAttachments = await desktopApi.chooseAttachmentFiles();
      if (selectedAttachments.length === 0) {
        return;
      }

      addAttachments(selectedAttachments);
      setStatus(
        `Attached ${selectedAttachments.length} file${
          selectedAttachments.length === 1 ? "" : "s"
        }.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function addAttachments(nextAttachments: ComposerAttachment[]) {
    setAttachments(previous => {
      const existingPaths = new Set(previous.map(item => item.path));
      return [
        ...previous,
        ...nextAttachments.filter(item => !existingPaths.has(item.path))
      ];
    });
  }

  function removeAttachment(id: string) {
    setAttachments(previous => previous.filter(item => item.id !== id));
  }

  async function handleRelayMessage(data: unknown) {
    const envelope = parseRelayEnvelope(data);
    if (!envelope) {
      return;
    }
    const clientCommandId = clientCommandIdFromEnvelope(envelope);
    if (clientCommandId && processedClientCommandIdsRef.current.has(clientCommandId)) {
      ackClientCommand(clientCommandId);
      return;
    }

    if (envelope.type === "relay.presence") {
      setRelayPresence(relayPresenceFromPayload(envelope.payload));
      return;
    }

    if (envelope.type === "event.published") {
      const sourceEventId = relayPublishedSourceEventId(envelope.payload);
      if (sourceEventId) {
        delete pendingReliableRelayEventsRef.current[sourceEventId];
      }
      return;
    }

    if (clientCommandId && envelope.type.startsWith("client.")) {
      ackClientCommand(clientCommandId);
    }

    if (envelope.type === "client.refresh_sessions") {
      await refreshRelaySessions();
      return;
    }

    if (envelope.type === "client.search_composer") {
      const mode = envelope.payload?.mode;
      const requestId = envelope.payload?.requestId;
      const query = envelope.payload?.query ?? "";
      const limit = envelope.payload?.limit ?? 36;
      const cwd = envelope.payload?.workspace || activeWorkspaceRef.current;
      if (!desktopApi || (mode !== "file" && mode !== "skill") || !requestId) {
        return;
      }
      let items: ComposerSuggestion[] = [];
      try {
        items =
          mode === "file" && cwd
            ? await desktopApi.searchWorkspaceFiles({ cwd, query, limit })
            : mode === "skill"
              ? await desktopApi.searchSkills({ cwd: cwd || undefined, query, limit })
              : [];
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
      publishRelay({
        type: "desktop.composer_suggestions",
        payload: { requestId, mode, query, items }
      });
      return;
    }

    if (envelope.type === "client.preview_file") {
      const requestId = envelope.payload?.requestId;
      const requestedPath = envelope.payload?.path;
      const cwd = envelope.payload?.workspace || activeWorkspaceRef.current;
      if (!requestId || !requestedPath || !cwd) {
        return;
      }
      try {
        const preview = await desktopApi.previewWorkspaceFile({
          cwd,
          path: requestedPath,
          maxBytes: envelope.payload?.maxBytes
        });
        publishRelay({
          type: "desktop.file_preview",
          payload: { requestId, workspace: cwd, preview }
        });
      } catch (error) {
        publishRelay({
          type: "desktop.file_preview",
          payload: {
            requestId,
            workspace: cwd,
            path: requestedPath,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      }
      return;
    }

    if (envelope.type === "client.send_message") {
      const text = envelope.payload?.text?.trim() ?? "";
      const remoteAttachments = validRemoteAttachments(envelope.payload?.attachments);
      if (!text && remoteAttachments.length === 0) {
        ackClientCommand(clientCommandId);
        return;
      }
      const targetSession = sessionTargetFromCommand(envelope);
      if (!targetSession) {
        setStatus("Mobile message ignored: no target session is available.");
        ackClientCommand(clientCommandId);
        return;
      }
      ackClientCommand(clientCommandId);
      const remoteImages = remoteAttachments.filter(
        (attachment): attachment is Extract<RemoteAttachmentInput, { kind: "image" }> =>
          attachment.kind === "image"
      );
      const remoteMentions = remoteAttachments
        .filter(
          (attachment): attachment is Extract<RemoteAttachmentInput, { kind: "mention" }> =>
            attachment.kind === "mention"
        )
        .map(attachment => ({
          id: `${attachment.path}-${Date.now()}`,
          type: "mention" as const,
          path: attachment.path,
          name: attachment.name
        }));
      const savedImages =
        remoteImages.length > 0 && desktopApi
          ? await desktopApi.saveRemoteAttachments(remoteImages)
          : [];
      const savedAttachments = [...savedImages, ...remoteMentions];
      if (runningTurnsBySessionRef.current[targetSession.session.threadId]) {
        enqueueRemoteTurn(targetSession.session.threadId, {
          text,
          attachments: savedAttachments,
          session: targetSession.session
        });
        return;
      }
      await sendTurnRequest(text, savedAttachments, targetSession.session, {
        clearLocalComposer: false
      });
      return;
    }

    if (envelope.type === "client.interrupt") {
      ackClientCommand(clientCommandId);
      await interruptTurn();
      return;
    }

    if (envelope.type === "client.open_session") {
      const cwd = envelope.payload?.workspace;
      const sessionId = envelope.payload?.sessionId;
      if (!cwd || !sessionId) {
        return;
      }
      if (hiddenSessionIdsRef.current.has(sessionId)) {
        ackClientCommand(clientCommandId);
        setStatus("Mobile open session ignored: session is removed from the list.");
        return;
      }
      const target =
        (workspaceSessions[cwd] ?? []).find(item => item.threadId === sessionId) ??
        ({ threadId: sessionId, title: workspaceName(cwd) } satisfies SessionView);
      ackClientCommand(clientCommandId);
      await openSession(target, cwd);
      return;
    }

    if (envelope.type === "client.open_workspace") {
      const cwd = envelope.payload?.workspace?.trim();
      ackClientCommand(clientCommandId);
      if (cwd) {
        const nextWorkspaces = upsertWorkspace(workspaces, cwd);
        setWorkspaces(nextWorkspaces);
        saveWorkspaces(nextWorkspaces);
        selectWorkspace(cwd);
        setStatus(`Opening workspace ${workspaceName(cwd)} from mobile.`);
        await refreshSessions(cwd, { openPreferred: true });
      }
      return;
    }

    if (envelope.type === "client.open_workspace_path") {
      const cwd = envelope.payload?.workspace?.trim();
      ackClientCommand(clientCommandId);
      if (cwd) {
        const nextWorkspaces = upsertWorkspace(workspaces, cwd);
        setWorkspaces(nextWorkspaces);
        saveWorkspaces(nextWorkspaces);
        selectWorkspace(cwd);
        setStatus(`Opening workspace ${workspaceName(cwd)} from mobile.`);
        await refreshSessions(cwd, { openPreferred: true });
      }
      return;
    }

    if (envelope.type === "client.new_session") {
      const cwd = envelope.payload?.workspace;
      if (cwd) {
        ackClientCommand(clientCommandId);
        await startNewSessionForWorkspace(cwd);
      } else {
        ackClientCommand(clientCommandId);
      }
      return;
    }

    if (envelope.type === "client.rename_session") {
      const cwd = envelope.payload?.workspace;
      const sessionId = envelope.payload?.sessionId;
      const title = envelope.payload?.title?.trim();
      if (!cwd || !sessionId || !title) {
        return;
      }
      const target =
        (workspaceSessions[cwd] ?? []).find(item => item.threadId === sessionId) ??
        ({ threadId: sessionId, title, updatedAt: undefined } satisfies SessionView);
      ackClientCommand(clientCommandId);
      await renameSessionTo(cwd, target, title, { prompt: false });
      return;
    }

    if (envelope.type === "client.remove_session") {
      const cwd = envelope.payload?.workspace;
      const sessionId = envelope.payload?.sessionId;
      if (!cwd || !sessionId) {
        return;
      }
      const target =
        (workspaceSessions[cwd] ?? []).find(item => item.threadId === sessionId) ??
        ({ threadId: sessionId, title: sessionId.slice(0, 8), updatedAt: undefined } satisfies SessionView);
      ackClientCommand(clientCommandId);
      removeSession(cwd, target, { confirm: false });
      return;
    }

    if (envelope.type === "client.remove_workspace") {
      const cwd = envelope.payload?.workspace?.trim();
      if (cwd) {
        removeWorkspace(cwd, { confirm: false });
      }
      ackClientCommand(clientCommandId);
      return;
    }

    if (envelope.type === "client.resolve_approval") {
      const requestId = envelope.payload?.requestId;
      const decision = envelope.payload?.decision;
      const approval = approvals.find(item => String(item.id) === String(requestId));
      if (approval && decision) {
        await resolveApproval(approval, decision);
      }
      ackClientCommand(clientCommandId);
      return;
    }

    if (envelope.type === "client.set_permissions") {
      const nextMode = envelope.payload?.permissionMode;
      if (isPermissionMode(nextMode)) {
        updatePermissionMode(nextMode);
      }
      ackClientCommand(clientCommandId);
      return;
    }

    if (envelope.type === "client.set_model") {
      if (typeof envelope.payload?.model === "string") {
        updateModel(envelope.payload.model);
      }
      if (isModelEffort(envelope.payload?.effort)) {
        updateModelEffort(envelope.payload.effort);
      }
      ackClientCommand(clientCommandId);
    }
  }

  async function refreshRelaySessions() {
    if (!desktopApi || connectionState !== "connected") {
      scheduleDesktopSnapshot();
      return;
    }

    const targetWorkspaces = workspaces.length > 0
      ? workspaces
      : workspace
        ? [workspace]
        : [];
    if (targetWorkspaces.length === 0) {
      publishDesktopSnapshot();
      return;
    }

    setStatus("Refreshing sessions for mobile.");
    await Promise.all(
      targetWorkspaces.map(cwd =>
        refreshSessions(cwd, {
          openPreferred: false,
          preserveSession:
            cwd === activeWorkspaceRef.current ? activeSessionRef.current : null
        })
      )
    );
    scheduleDesktopSnapshot();
    scheduleReliableDesktopSnapshot();
  }

  function buildDesktopSnapshotPayload(): unknown {
    const snapshotWorkspaces: RemoteSnapshotWorkspace[] = workspaces.map(cwd => ({
      path: cwd,
      name: workspaceName(cwd),
      sessions: (workspaceSessions[cwd] ?? []).map(item => ({
        id: item.threadId,
        title: item.title,
        updatedAt: sessionMeta(item),
        status: runningTurnsBySession[item.threadId] ? "working" : "ready",
        unread: unreadSessionIds.has(item.threadId),
        activeTurnId: runningTurnsBySession[item.threadId] ?? null,
        turnStartedAt: turnStartedAtBySession[item.threadId] ?? null,
        lastTurnDurationMs: lastTurnDurationBySession[item.threadId] ?? null
      }))
    }));

    return {
      device: {
        id: deviceId,
        name: "three workstation",
        workspace: workspace ?? "",
        connection: relayState === "connected" ? "online" : "offline",
        lastSeen: "Now"
      },
      workspaces: snapshotWorkspaces,
      activeWorkspace: workspace,
      sessions: sessions.map(item => ({
        id: item.threadId,
        title: item.title,
        updatedAt: sessionMeta(item),
        status: runningTurnsBySession[item.threadId] ? "working" : "ready",
        unread: unreadSessionIds.has(item.threadId),
        activeTurnId: runningTurnsBySession[item.threadId] ?? null,
        turnStartedAt: turnStartedAtBySession[item.threadId] ?? null,
        lastTurnDurationMs: lastTurnDurationBySession[item.threadId] ?? null
      })),
      activeSessionId: session?.threadId ?? null,
      messages: transcript.slice(-40).map(remoteMessageFromTranscript),
      approvals: approvals.map(item => ({
        id: String(item.id),
        title: item.type,
        detail: approvalSummary(item.request),
        risk: item.type === "permissions" ? "high" : "medium"
      })),
      periodicTasks: periodicTasks.map(task => ({
        id: task.id,
        name: task.name,
        enabled: task.enabled,
        workspace: task.workspace,
        sessionId: task.sessionId ?? null,
        trigger: task.trigger,
        intervalMs: task.intervalMs,
        scheduleFrequency: task.scheduleFrequency,
        scheduleTime: task.scheduleTime,
        scheduleWeekdays: task.scheduleWeekdays,
        status: task.status,
        nextRunAt: task.nextRunAt ?? null,
        lastRunAt: task.lastRunAt ?? null,
        lastCompletedAt: task.lastCompletedAt ?? null,
        lastError: task.lastError ?? null
      })),
      status,
      permissionMode,
      model,
      modelOptions,
      modelEffort,
      contextUsage,
      rateLimitUsage,
      isWorking: session ? Boolean(runningTurnsBySession[session.threadId]) : false,
      appVersion: desktopPackage.version,
      releaseUrl: desktopUpdate?.releaseUrl ?? desktopUpdate?.downloadUrl ?? null
    };
  }

  function publishDesktopSnapshot(snapshot = buildDesktopSnapshotPayload()) {
    latestDesktopSnapshotRef.current = snapshot;
    publishRelay({
      type: "desktop.snapshot",
      payload: snapshot
    });
  }

  function scheduleDesktopSnapshot() {
    if (DEMO_MODE) {
      return;
    }
    if (desktopSnapshotTimerRef.current !== null) {
      return;
    }
    desktopSnapshotTimerRef.current = window.setTimeout(() => {
      desktopSnapshotTimerRef.current = null;
      publishDesktopSnapshot(
        latestDesktopSnapshotRef.current ?? buildDesktopSnapshotPayload()
      );
    }, DESKTOP_SNAPSHOT_DEBOUNCE_MS);
  }

  function scheduleReliableDesktopSnapshot() {
    if (DEMO_MODE) {
      return;
    }
    if (reliableSnapshotTimerRef.current !== null) {
      window.clearTimeout(reliableSnapshotTimerRef.current);
    }
    reliableSnapshotTimerRef.current = window.setTimeout(() => {
      reliableSnapshotTimerRef.current = null;
      publishReliableDesktopSnapshot();
    }, RELIABLE_SNAPSHOT_DEBOUNCE_MS);
  }

  function publishReliableDesktopSnapshot() {
    const snapshot = latestDesktopSnapshotRef.current ?? buildDesktopSnapshotPayload();
    const signature = JSON.stringify(snapshot);
    if (signature === lastReliableSnapshotSignatureRef.current) {
      return;
    }
    lastReliableSnapshotSignatureRef.current = signature;

    const revision = reliableSnapshotRevisionRef.current + 1;
    reliableSnapshotRevisionRef.current = revision;
    const sourceEventId = `${deviceId}:desktop.snapshot:${revision}`;
    prunePendingReliableSnapshotEvents();
    publishReliableRelayEvent(sourceEventId, {
      type: "event.publish",
      payload: {
        source_event_id: sourceEventId,
        type: "desktop.snapshot",
        workspace_id: workspace ?? "",
        session_id: session?.threadId ?? "",
        title: session?.title ?? "Desktop snapshot",
        body: status,
        payload: {
          revision,
          snapshot
        }
      }
    });
  }

  function publishTurnCompletedEvent(
    event: Extract<CodexAdapterEvent, { type: "turn.completed" }>
  ) {
    const sessionInfo = sessionInfoForThread(event.threadId);
    const sessionTitle = sessionInfo.title.trim();
    const finalMessage = finalAssistantMessageForTurn(event.threadId, event.turnId);
    const notificationBody = relayNotificationBodyFromFinalMessage(finalMessage);
    const startedAt = turnStartedAtBySessionRef.current[event.threadId];
    const durationMs = startedAt
      ? Math.max(Date.now() - startedAt, 0)
      : lastTurnDurationBySession[event.threadId] ?? null;
    const sourceEventId = `${deviceId}:${event.threadId}:${event.turnId}:turn.completed`;
    publishReliableRelayEvent(sourceEventId, {
      type: "event.publish",
      payload: {
        source_event_id: sourceEventId,
        type: "turn.completed",
        workspace_id: sessionInfo.workspace ?? "",
        session_id: event.threadId,
        title: sessionTitle || "Codex+",
        body: notificationBody || "Codex turn completed.",
        payload: {
          turn_id: event.turnId,
          duration_ms: durationMs,
          session_title: sessionTitle,
          workspace: sessionInfo.workspace ?? "",
          notification_body: notificationBody,
          final_message: finalMessage
        }
      }
    });
  }

  function appendTurnAssistantText(threadId: string, turnId: string, delta: string) {
    if (!threadId || !turnId || !delta) {
      return;
    }
    const current = turnAssistantTextRef.current[threadId];
    turnAssistantTextRef.current[threadId] =
      current?.turnId === turnId
        ? { ...current, text: current.text + delta }
        : { turnId, text: delta, createdAt: Date.now() };
  }

  function finalAssistantMessageForTurn(threadId: string, turnId: string): string {
    const current = turnAssistantTextRef.current[threadId];
    const latestAssistant = latestAssistantTranscriptText(threadId);
    if (latestAssistant) {
      return latestAssistant;
    }
    if (current?.turnId === turnId) {
      return current.text;
    }
    return "";
  }

  function latestAssistantTranscriptText(threadId: string): string {
    if (!isActiveEventThread(threadId)) {
      return "";
    }
    for (let index = transcriptRef.current.length - 1; index >= 0; index -= 1) {
      const entry = transcriptRef.current[index];
      if (entry?.role === "assistant" && entry.text.trim()) {
        return entry.text;
      }
    }
    return "";
  }

  function sessionInfoForThread(threadId: string) {
    for (const [cwd, items] of Object.entries(workspaceSessionsRef.current)) {
      const found = items.find(item => item.threadId === threadId);
      if (found) {
        return { workspace: cwd, title: found.title };
      }
    }
    const activeSession = activeSessionRef.current;
    if (activeSession?.threadId === threadId) {
      return { workspace: activeWorkspaceRef.current, title: activeSession.title };
    }
    return { workspace: null, title: "" };
  }

  function sessionTargetFromCommand(envelope: RemoteCommandEnvelope): {
    workspace: string | null;
    session: SessionView;
  } | null {
    const payload = envelope.payload;
    const sessionId = payload?.sessionId?.trim();
    const cwd = payload?.workspace?.trim();
    if (sessionId) {
      if (hiddenSessionIdsRef.current.has(sessionId)) {
        return null;
      }
      const workspaceEntries = cwd
        ? [[cwd, workspaceSessionsRef.current[cwd] ?? []] as const]
        : Object.entries(workspaceSessionsRef.current);
      for (const [workspacePath, items] of workspaceEntries) {
        const found = items.find(item => item.threadId === sessionId);
        if (found) {
          return { workspace: workspacePath, session: found };
        }
      }
      return {
        workspace: cwd || activeWorkspaceRef.current,
        session: {
          threadId: sessionId,
          title: cwd ? workspaceName(cwd) : "Mobile session"
        }
      };
    }
    const activeSession = activeSessionRef.current;
    return activeSession
      ? { workspace: activeWorkspaceRef.current, session: activeSession }
      : null;
  }

  function publishReliableRelayEvent(sourceEventId: string, message: RelayEnvelope) {
    pendingReliableRelayEventsRef.current[sourceEventId] = message;
    flushReliableRelayEvents();
  }

  function prunePendingReliableSnapshotEvents() {
    const snapshotPrefix = `${deviceId}:desktop.snapshot:`;
    for (const sourceEventId of Object.keys(pendingReliableRelayEventsRef.current)) {
      if (sourceEventId.startsWith(snapshotPrefix)) {
        delete pendingReliableRelayEventsRef.current[sourceEventId];
      }
    }
  }

  function flushReliableRelayEvents() {
    const socket = relaySocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    for (const message of Object.values(pendingReliableRelayEventsRef.current)) {
      socket.send(JSON.stringify(message));
    }
  }

  function publishRelay(message: RelayEnvelope) {
    const socket = relaySocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  }

  function scheduleRelayProgress(threadId: string, payload: RelayProgressPayload) {
    if (!threadId) {
      return;
    }
    pendingRelayProgressRef.current = {
      ...pendingRelayProgressRef.current,
      [threadId]: payload
    };
    if (relayProgressTimerRef.current !== null) {
      return;
    }
    relayProgressTimerRef.current = window.setTimeout(() => {
      relayProgressTimerRef.current = null;
      flushRelayProgress();
    }, RELAY_PROGRESS_DEBOUNCE_MS);
  }

  function flushRelayProgress() {
    if (relayProgressTimerRef.current !== null) {
      window.clearTimeout(relayProgressTimerRef.current);
      relayProgressTimerRef.current = null;
    }
    const pending = pendingRelayProgressRef.current;
    pendingRelayProgressRef.current = {};
    for (const payload of Object.values(pending)) {
      publishRelay({
        type: "desktop.progress",
        payload
      });
    }
  }

  function relayAssistantProgressMessage(
    threadId: string,
    turnId: string
  ): RemoteSnapshotMessage | undefined {
    const current = turnAssistantTextRef.current[threadId];
    if (current?.turnId !== turnId || !current.text.trim()) {
      return undefined;
    }
    return {
      id: `assistant-progress-${turnId}`,
      role: "codex",
      text: relayMessageTextFromTranscriptText(current.text),
      meta: "streaming",
      createdAt: current.createdAt
    };
  }

  function ackClientCommand(clientCommandId: string | null) {
    if (!clientCommandId) {
      return;
    }
    const nextIds = rememberClientCommandId(
      processedClientCommandIdsRef.current,
      clientCommandId
    );
    processedClientCommandIdsRef.current = nextIds;
    publishRelay({
      type: "client.command_ack",
      payload: { client_message_id: clientCommandId }
    });
  }

  function updateRelayEndpoint(value: string) {
    setRelayEndpoint(value);
    window.localStorage.setItem(RELAY_ENDPOINT_STORAGE_KEY, value);
  }

  function updateRelayApiKey(value: string) {
    setRelayApiKey(value);
    window.localStorage.setItem(RELAY_API_KEY_STORAGE_KEY, value);
  }

  function updatePermissionMode(value: PermissionMode) {
    setPermissionMode(value);
    window.localStorage.setItem(PERMISSIONS_STORAGE_KEY, value);
    setStatus(`Permissions set to ${permissionLabel(value, language)}.`);
  }

  function updateThemeMode(value: ThemeMode) {
    setThemeMode(value);
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
    setStatus(`Theme set to ${value}.`);
  }

  function updateLanguage(value: UILanguage) {
    setLanguage(value);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
    setStatus(`Language set to ${LANGUAGE_OPTIONS.find(option => option.value === value)?.label ?? value}.`);
  }

  function updateSoundNotificationsEnabled(value: boolean) {
    setSoundNotificationsEnabled(value);
    window.localStorage.setItem(SOUND_NOTIFICATIONS_STORAGE_KEY, String(value));
    setStatus(value ? "Turn completion sound enabled." : "Turn completion sound disabled.");
  }

  function updateNotificationSoundVolume(value: number) {
    const nextVolume = clampPercent(Math.round(value));
    setNotificationSoundVolume(nextVolume);
    window.localStorage.setItem(
      NOTIFICATION_SOUND_VOLUME_STORAGE_KEY,
      String(nextVolume)
    );
  }

  async function chooseNotificationSound() {
    if (!desktopApi) {
      return;
    }

    try {
      const file = await desktopApi.chooseNotificationSoundFile();
      if (!file) {
        return;
      }
      setNotificationSoundFile(file);
      window.localStorage.setItem(
        NOTIFICATION_SOUND_FILE_STORAGE_KEY,
        JSON.stringify(file)
      );
      setStatus(`Notification sound set to ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function clearNotificationSound() {
    setNotificationSoundFile(null);
    window.localStorage.removeItem(NOTIFICATION_SOUND_FILE_STORAGE_KEY);
    setStatus("Notification sound cleared.");
  }

  function updateModel(value: string) {
    const nextModel = value.trim();
    if (!nextModel) {
      return;
    }
    setModel(nextModel);
    window.localStorage.setItem(MODEL_STORAGE_KEY, nextModel);
    setStatus(`Model set to ${nextModel}.`);
  }

  function updateModelEffort(value: ModelEffort) {
    setModelEffort(value);
    window.localStorage.setItem(MODEL_EFFORT_STORAGE_KEY, value);
    setStatus(`Reasoning set to ${effortLabel(value, language)}.`);
  }

  function handleTurnCompletedReminder(threadId: string) {
    if (soundNotificationsEnabled) {
      void playTurnCompletionSound();
    }

    const activeSessionId = activeSessionIdRef.current;
    const isActiveAndVisible =
      activeSessionId === threadId &&
      document.visibilityState === "visible" &&
      document.hasFocus();
    if (!isActiveAndVisible) {
      markSessionUnread(threadId);
    }
  }

  async function playTurnCompletionSound() {
    try {
      try {
        const audio = new Audio(
          notificationSoundFile?.url ?? DEFAULT_NOTIFICATION_SOUND_FILE.url
        );
        audio.volume = notificationSoundVolume / 100;
        await audio.play();
      } catch {
        await playFallbackNotificationTone(notificationSoundVolume);
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Unable to play notification sound: ${error.message}`
          : "Unable to play notification sound."
      );
    }
  }

  function markSessionUnread(threadId: string) {
    setUnreadSessionIds(previous => {
      if (previous.has(threadId)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(threadId);
      saveStringList(UNREAD_SESSIONS_STORAGE_KEY, Array.from(next));
      return next;
    });
  }

  function clearSessionUnread(threadId: string) {
    setUnreadSessionIds(previous => {
      if (!previous.has(threadId)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(threadId);
      saveStringList(UNREAD_SESSIONS_STORAGE_KEY, Array.from(next));
      return next;
    });
  }

  function applyRuntimeSettingsFromResponse(response: {
    model?: string;
    reasoningEffort?: string | null;
  }) {
    if (response.model) {
      setModel(response.model);
      window.localStorage.setItem(MODEL_STORAGE_KEY, response.model);
    }
    if (isModelEffort(response.reasoningEffort)) {
      setModelEffort(response.reasoningEffort);
      window.localStorage.setItem(MODEL_EFFORT_STORAGE_KEY, response.reasoningEffort);
    }
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    lastPasteEventAt.current = Date.now();
    const shouldHandleAttachment = shouldHandleAttachmentPaste(event.clipboardData);
    if (shouldHandleAttachment) {
      event.preventDefault();
    }
    void pasteAttachments({
      quiet: !shouldHandleAttachment && hasNormalTextPaste(event.clipboardData)
    });
  }

  function handleComposerChange(value: string, cursor: number) {
    setComposer(value);
    updateComposerCompletion(value, cursor);
  }

  function updateComposerCompletion(value: string, cursor: number) {
    const trigger = activeComposerTrigger(value, cursor);
    if (!trigger || !session) {
      setComposerCompletion(null);
      return;
    }

    setComposerCompletion(current => ({
      mode: trigger.mode,
      query: trigger.query,
      tokenStart: trigger.tokenStart,
      cursor,
      items:
        current?.mode === trigger.mode && current.query === trigger.query
          ? current.items
          : [],
      selectedIndex:
        current?.mode === trigger.mode && current.query === trigger.query
          ? current.selectedIndex
          : 0,
      loading: true
    }));
  }

  function openComposerCompletion(mode: ComposerCompletionMode) {
    if (!session) {
      return;
    }

    const cursor = composerRef.current?.selectionStart ?? composer.length;
    setComposerCompletion({
      mode,
      query: "",
      tokenStart: cursor,
      cursor,
      items: [],
      selectedIndex: 0,
      loading: true
    });
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent & {
      isComposing?: boolean;
    };

    if (composerCompletion) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setComposerCompletion(current => {
          if (!current || current.items.length === 0) {
            return current;
          }
          const nextIndex =
            (current.selectedIndex + direction + current.items.length) %
            current.items.length;
          return { ...current, selectedIndex: nextIndex };
        });
        return;
      }

      if (
        (event.key === "Enter" || event.key === "Tab") &&
        composerCompletion.items[composerCompletion.selectedIndex]
      ) {
        event.preventDefault();
        acceptComposerCompletion(
          composerCompletion.items[composerCompletion.selectedIndex]
        );
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setComposerCompletion(null);
        return;
      }
    }

    if (event.key === "Escape" && isTurnRunning) {
      event.preventDefault();
      event.stopPropagation();
      void interruptTurn();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      window.setTimeout(() => {
        if (Date.now() - lastPasteEventAt.current < 180) {
          return;
        }
        void pasteAttachments();
      }, 80);
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !nativeEvent.isComposing
    ) {
      event.preventDefault();
      void sendTurn();
    }
  }

  function acceptComposerCompletion(item: ComposerSuggestion) {
    if (!composerCompletion) {
      return;
    }

    const suffix = composer.slice(composerCompletion.cursor);
    const insertText = `${item.insertText} `;
    const nextCursor = composerCompletion.tokenStart + insertText.length;
    const nextComposer = `${composer.slice(0, composerCompletion.tokenStart)}${insertText}${suffix}`;
    setComposer(nextComposer);
    setComposerCompletion(null);

    if (item.type === "file" && item.path) {
      addAttachments([
        {
          id: `${item.path}-${Date.now()}`,
          type: "mention",
          path: item.path,
          name: item.name
        }
      ]);
    }

    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function interruptTurn() {
    const targetSession = activeSessionRef.current;
    const targetTurnId = targetSession
      ? runningTurnsBySessionRef.current[targetSession.threadId]
      : null;
    if (!desktopApi || !targetSession || !targetTurnId) {
      return;
    }

    setStatus("Interrupt requested.");
    clearSessionTurnRunning(targetSession.threadId);
    try {
      await desktopApi.interruptTurn({
        threadId: targetSession.threadId,
        turnId: targetTurnId
      });
      setStatus("Turn interrupted.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Stop request failed; local working state was reset. ${error.message}`
          : `Stop request failed; local working state was reset. ${String(error)}`
      );
    }
  }

  async function resolveApproval(
    approval: ApprovalEntry,
    decision: "accept" | "decline" | "cancel"
  ) {
    if (!desktopApi) {
      return;
    }

    await desktopApi.resolveApproval({ requestId: approval.id, decision });
    setApprovals(previous => previous.filter(item => item.id !== approval.id));
    setStatus(`Approval ${decision}.`);
  }

  function dismissDesktopUpdate(version: string | null) {
    if (!version) {
      setDesktopUpdate(null);
      return;
    }

    window.localStorage.setItem(UPDATE_DISMISSED_STORAGE_KEY, version);
    setDismissedUpdateVersion(version);
  }

  async function openDesktopUpdateDownload(update: DesktopUpdateInfo) {
    if (!desktopApi) {
      return;
    }

    try {
      const openedDownloadedFile = Boolean(update.downloadedPath);
      if (update.downloadedPath) {
        await desktopApi.revealDownloadedUpdate(update.downloadedPath);
      } else if (update.downloadUrl) {
        await desktopApi.openUpdateDownload(update.downloadUrl);
      } else if (update.releaseUrl) {
        await desktopApi.openUpdateDownload(update.releaseUrl);
      } else {
        return;
      }
      dismissDesktopUpdate(update.latestVersion);
      setStatus(
        language === "zh-CN"
          ? openedDownloadedFile
            ? `已打开 ${update.latestVersion ?? "新版"} 更新文件。`
            : `已打开 ${update.latestVersion ?? "新版"} 下载页面。`
          : openedDownloadedFile
            ? `Opened update file for ${update.latestVersion ?? "the new version"}.`
            : `Opened download page for ${update.latestVersion ?? "the new version"}.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className={`shell${isSidebarCollapsed ? " sidebarCollapsed" : ""}`}>
      {visibleDesktopUpdate && isUpdateDialogOpen ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setIsUpdateDialogOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="desktop-update-title"
            aria-modal="true"
            className="updateModal"
            role="dialog"
          >
            <header className="modalHeader">
              <div>
                <h2 id="desktop-update-title">{t("updateAvailable")}</h2>
                <p>
                  {t(
                    visibleDesktopUpdate.downloadedPath
                      ? "updateAvailableBody"
                      : "updateAvailableBodyRemote",
                    { version: visibleDesktopUpdate.latestVersion ?? "" }
                  )}
                </p>
              </div>
              <button
                aria-label={t("dismissUpdate")}
                className="iconOnlyButton compactIconButton"
                type="button"
                onClick={() => setIsUpdateDialogOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="updateModalBody">
              {visibleDesktopUpdate.releaseNotes ? (
                <p>{visibleDesktopUpdate.releaseNotes}</p>
              ) : null}
              <div className="updateModalActions">
                <button
                  className="miniButton primaryMiniButton"
                  type="button"
                  onClick={() => void openDesktopUpdateDownload(visibleDesktopUpdate)}
                >
                  <Download size={14} />
                  <span>
                    {visibleDesktopUpdate.downloadedPath
                      ? t("downloadUpdate")
                      : t("openRelease")}
                  </span>
                </button>
                <button
                  className="miniButton"
                  type="button"
                  onClick={() => dismissDesktopUpdate(visibleDesktopUpdate.latestVersion)}
                >
                  <X size={14} />
                  <span>{t("dismissUpdate")}</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      <aside
        className="sidebar"
        aria-label={t("sessions")}
        data-collapsed={isSidebarCollapsed}
      >
        <div className="brand">
          <div className="brandMark">C</div>
          <div className="brandText">
            <h1>Codex+</h1>
            <p>{APP_VERSION_LABEL}</p>
          </div>
          <button
            className="sidebarToggle"
            type="button"
            aria-label={isSidebarCollapsed ? t("expandSidebar") : t("collapseSidebar")}
            aria-expanded={!isSidebarCollapsed}
            onClick={() => setIsSidebarCollapsed(previous => !previous)}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
          </button>
        </div>

        {visibleDesktopUpdate ? (
          <div className="updateNotice" role="status">
            <div>
              <strong>{t("updateAvailable")}</strong>
              <span>
                {t(
                  visibleDesktopUpdate.downloadedPath
                    ? "updateAvailableBody"
                    : "updateAvailableBodyRemote",
                  { version: visibleDesktopUpdate.latestVersion ?? "" }
                )}
              </span>
            </div>
            <div className="updateNoticeActions">
              <button
                className="miniButton primaryMiniButton"
                type="button"
                onClick={() => void openDesktopUpdateDownload(visibleDesktopUpdate)}
              >
                <Download size={14} />
                <span>
                  {visibleDesktopUpdate.downloadedPath
                    ? t("downloadUpdate")
                    : t("openRelease")}
                </span>
              </button>
              <button
                aria-label={t("dismissUpdate")}
                className="iconOnlyButton compactIconButton"
                type="button"
                onClick={() => dismissDesktopUpdate(visibleDesktopUpdate.latestVersion)}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ) : null}

        <section className="panel grow">
          <div className="panelHeader">
            <h2>{t("workspaces")}</h2>
            <div className="panelActions">
              <button
                className="miniButton primaryMiniButton"
                type="button"
                disabled={workspaces.length === 0}
                onClick={openNewConversationModal}
                aria-label={t("newConversation")}
              >
                <Plus size={14} />
                <span>{t("newConversation")}</span>
              </button>
            </div>
          </div>
          <div className="sidebarTabs" role="tablist" aria-label={t("sessionViews")}>
            <button
              aria-selected={sidebarTab === "all"}
              className="sidebarTab"
              role="tab"
              type="button"
              onClick={() => setSidebarTab("all")}
            >
              {t("all")}
            </button>
            <button
              aria-selected={sidebarTab === "recent"}
              className="sidebarTab"
              role="tab"
              type="button"
              onClick={() => setSidebarTab("recent")}
            >
              {t("recent")}
            </button>
            <button
              aria-selected={sidebarTab === "automations"}
              className="sidebarTab"
              role="tab"
              type="button"
              onClick={() => setSidebarTab("automations")}
            >
              {t("automationsTab")}
            </button>
          </div>
          {workspaces.length > 0 ? (
            <div className="workspaceTree">
              {sidebarTab === "all"
                ? (
                    <>
                      <button
                        className="addWorkspaceRow"
                        type="button"
                        onClick={chooseWorkspace}
                      >
                        <Plus size={14} />
                        <span>{t("addWorkspace")}</span>
                      </button>
                      {workspaces.map(cwd => {
                    const workspaceItems = workspaceSessions[cwd] ?? [];
                    const isCollapsed = collapsedWorkspaces.has(cwd);
                    return (
                      <div className="workspaceGroup" key={cwd}>
                        <div className="workspaceNode" data-active={cwd === workspace}>
                          <button
                            aria-label={
                              isCollapsed
                                ? `Expand ${workspaceName(cwd)}`
                                : `Collapse ${workspaceName(cwd)}`
                            }
                            aria-expanded={!isCollapsed}
                            className="treeIconButton"
                            type="button"
                            onClick={() => toggleWorkspaceCollapsed(cwd)}
                          >
                            <ChevronRight
                              size={14}
                              className={isCollapsed ? "" : "disclosureOpen"}
                            />
                          </button>
                          <button
                            className="workspaceSelect"
                            type="button"
                            onClick={() => selectWorkspace(cwd)}
                          >
                            <FolderOpen size={15} />
                            <span>{workspaceName(cwd)}</span>
                            <small>{cwd}</small>
                          </button>
                          <WorkspaceActionMenu
                            disabled={connectionState !== "connected" || isSessionOpening}
                            language={language}
                            workspaceName={workspaceName(cwd)}
                            onNewSession={() => void startNewSessionForWorkspace(cwd)}
                            onRemove={() => removeWorkspace(cwd)}
                          />
                        </div>
                        {!isCollapsed ? (
                          <div className="sessionChildren">
                            {workspaceItems.length > 0 ? (
                              workspaceItems.map(item => (
                                <SessionTreeRow
                                  active={
                                    cwd === workspace &&
                                    item.threadId === session?.threadId
                                  }
                                  item={item}
                                  key={item.threadId}
                                  language={language}
                                  unread={unreadSessionIds.has(item.threadId)}
                                  working={Boolean(runningTurnsBySession[item.threadId])}
                                  onOpen={() => void openSession(item, cwd)}
                                  onRemove={() => removeSession(cwd, item)}
                                  onRename={title => void renameSession(cwd, item, title)}
                                />
                              ))
                            ) : (
                              <p className="treeEmpty">
                                {isSessionsLoading && cwd === workspace
                                  ? t("loadingSessions")
                                  : t("noSessionsLoaded")}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                    </>
                  )
                : sidebarTab === "recent"
                ? recentSessions.length > 0
                  ? recentSessions.map(({ workspace: cwd, session: item }) => (
                      <div className="sessionGroup" key={item.threadId}>
                        <SessionTreeRow
                          active={cwd === workspace && item.threadId === session?.threadId}
                          item={item}
                          language={language}
                          meta={`${workspaceName(cwd)} · ${sessionMeta(item)}`}
                          unread={unreadSessionIds.has(item.threadId)}
                          working={Boolean(runningTurnsBySession[item.threadId])}
                          onOpen={() => void openSession(item, cwd)}
                          onRemove={() => removeSession(cwd, item)}
                          onRename={title => void renameSession(cwd, item, title)}
                        />
                      </div>
                    ))
                  : (
                      <div className="emptyTree">
                        <p>{t("recentEmpty")}</p>
                      </div>
                    )
                : (
                    <AutomationSidebar
                      language={language}
                      selectedTaskId={selectedPeriodicTaskId}
                      tasks={periodicTasks}
                      onNewTask={openNewPeriodicTaskModal}
                      onOpenTask={openPeriodicTaskModal}
                    />
                  )}
            </div>
          ) : (
            <div className="emptyTree">
              <p>{t("workspaceEmpty")}</p>
              <button className="miniButton primaryMiniButton" type="button" onClick={chooseWorkspace}>
                {t("addWorkspace")}
              </button>
            </div>
          )}
        </section>

        <div className="sidebarFooter">
          <div className="accountSummary" aria-label={t("account")}>
            <RateLimitRing
              label={t("fiveHourLimit")}
              shortLabel="5h"
              value={rateLimitUsage?.primary?.leftPercent ?? null}
              fallback={t("rateLimitUnknown")}
            />
            <RateLimitRing
              label={t("weeklyLimit")}
              shortLabel="7d"
              value={rateLimitUsage?.secondary?.leftPercent ?? null}
              fallback={t("rateLimitUnknown")}
            />
	            <button
	              aria-label={relayStatusTooltip}
	              className="sidebarRelayButton"
	              data-peer-state={(relayPresence?.clientCount ?? 0) > 0 ? "connected" : "empty"}
	              data-state={relayState}
	              onClick={() => setIsSettingsOpen(true)}
	              title={relayStatusTooltip}
	              type="button"
	            >
	              <RelayStatusIcon size={15} />
	              <span className="sidebarRelayLabel">
	                {relayPresence?.clientCount ?? 0} {t("mobileClientsShort")}
	              </span>
	            </button>
          </div>
          <div className="sidebarQuickControls">
            <SidebarOptionMenu
              icon={themeMode === "dark" ? <Moon size={15} /> : <Sun size={15} />}
              label={themeMode === "dark" ? t("dark") : t("light")}
              options={[
                { value: "dark", label: t("dark") },
                { value: "light", label: t("light") }
              ]}
              value={themeMode}
              onChange={value => updateThemeMode(value as ThemeMode)}
            />
            <SidebarOptionMenu
              icon={<Languages size={15} />}
              label={
                LANGUAGE_OPTIONS.find(option => option.value === language)?.label ??
                language
              }
              options={LANGUAGE_OPTIONS}
              value={language}
              onChange={value => updateLanguage(value as UILanguage)}
            />
            <button
              aria-label={t("openSettings")}
              className="sidebarSettingsButton"
              onClick={() => setIsSettingsOpen(true)}
              type="button"
            >
              <Settings size={15} />
              <span>{t("settings")}</span>
            </button>
          </div>
        </div>
      </aside>

      <section className="conversation" aria-label={t("conversation")}>
        <header className="topbar">
          <div>
            <h2>{session?.title ?? t("newCodexSession")}</h2>
            <p>{status}</p>
          </div>
        </header>
        <div className="messages" role="log" aria-live="polite" ref={messagesRef}>
            {isConversationLoading ? (
              <div className="loadingState">
                <span className="loadingSpinner" aria-hidden="true" />
                <h2>{t("loadingSessionTitle")}</h2>
                <p>{t("loadingSessionBody")}</p>
              </div>
            ) : transcript.length === 0 ? (
              <div className="emptyState">
                <h2>{t("startSessionTitle")}</h2>
                <p>{t("startSessionBody")}</p>
              </div>
            ) : (
              <div className="timeline">
                {hiddenTranscriptCount > 0 ? (
                  <div className="historyLoader">
                    <button type="button" onClick={loadOlderTranscript}>
                      {t("loadOlderMessages", {
                        count: Math.min(TRANSCRIPT_PAGE_SIZE, hiddenTranscriptCount)
                      })}
                    </button>
                    <span>{t("hiddenMessages", { count: hiddenTranscriptCount })}</span>
                  </div>
                ) : null}
                {visibleTranscript.map(entry => (
                  <TimelineEntry entry={entry} key={entry.id} language={language} />
                ))}
                {isTurnRunning ? (
                  <div className="timelineItem workingItem" aria-live="polite">
                    <span className="timelineMarker" aria-hidden="true" />
                    <div className="timelineContent">
                      <div className="timelineMeta">
                        <strong>{t("working")}</strong>
                        {activeTurnElapsedMs !== null ? (
                          <span className="turnDuration">
                            {formatTurnDuration(activeTurnElapsedMs)}
                          </span>
                        ) : null}
                        {activeTurnId ? <code>{activeTurnId.slice(0, 8)}</code> : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>


        <div className="composerDock">
          <InlineActionBar
            approvals={approvals}
            language={language}
            onResolveApproval={resolveApproval}
          />
          <div
            className="composerStatus"
            data-state={isTurnRunning ? "working" : session ? "ready" : "idle"}
          >
            <span className="statusDot" aria-hidden="true" />
            <span className="statusText">
              {isTurnRunning ? t("working") : session ? t("ready") : t("noSession")}
            </span>
            {visibleTurnDurationMs !== null ? (
              <span className="turnDuration">
                {formatTurnDuration(visibleTurnDurationMs)}
              </span>
            ) : null}
            {isTurnRunning ? (
              <span className="statusPulse" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            ) : null}
            {isTurnRunning && activeTurnId ? <code>{activeTurnId.slice(0, 8)}</code> : null}
          </div>
          <form
            className="composer"
            onSubmit={event => {
              event.preventDefault();
              void sendTurn();
            }}
          >
            {composerCompletion ? (
              <ComposerCompletionMenu
                completion={composerCompletion}
                language={language}
                onSelect={acceptComposerCompletion}
              />
            ) : null}
            <div className="composerMain">
              {attachments.length > 0 ? (
                <div className="attachmentShelf" aria-label={t("attachedFiles")}>
                  {attachments.map(attachment => (
                    <div className="attachmentChip" key={attachment.id}>
                      {attachment.previewDataUrl ? (
                        <img alt="" src={attachment.previewDataUrl} />
                      ) : (
                        <span className="attachmentIcon" aria-hidden="true">
                          <Paperclip size={14} />
                        </span>
                      )}
                      <div>
                        <strong>{attachment.name}</strong>
                        <small>
                          {attachment.type === "localImage" ? t("image") : t("fileMention")}
                        </small>
                      </div>
                      <button
                        aria-label={`Remove ${attachment.name}`}
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <textarea
                ref={composerRef}
                aria-label={t("messageCodex")}
                placeholder={t("composerPlaceholder")}
                value={composer}
                disabled={session === null}
                onChange={event =>
                  handleComposerChange(
                    event.target.value,
                    event.target.selectionStart
                  )
                }
                onPaste={handleComposerPaste}
                onKeyDown={handleComposerKeyDown}
                onSelect={event =>
                  updateComposerCompletion(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart
                  )
                }
              />
              <div className="composerToolbar" aria-label={t("messageCodex")}>
                <div className="composerTools">
                  <button
                    aria-label={t("attachFile")}
                    className="composerIconButton"
                    disabled={session === null}
                    onClick={() => void chooseAttachmentFiles()}
                    type="button"
                  >
                    <Plus size={16} />
                  </button>
                  <span className="composerDivider" aria-hidden="true" />
                  <button
                    aria-label={t("searchFiles")}
                    className="composerTextButton"
                    disabled={session === null}
                    onClick={() => openComposerCompletion("file")}
                    type="button"
                  >
                    <AtSign size={16} />
                    <span>{t("files")}</span>
                  </button>
                  <button
                    aria-label={t("searchSkills")}
                    className="composerTextButton"
                    disabled={session === null}
                    onClick={() => openComposerCompletion("skill")}
                    type="button"
                  >
                    <span className="composerDollarIcon" aria-hidden="true">$</span>
                    <span>{t("skills")}</span>
                  </button>
                </div>
                <div className="composerRightTools">
                  <span
                    className="composerContextValue"
                    title={contextTooltip(contextUsage, language)}
                  >
                    {contextLabel(contextUsage, language)}
                  </span>
                  <select
                    aria-label={t("switchModel")}
                    className="composerInlineSelect modelInlineSelect"
                    title={t("model")}
                    value={model}
                    onChange={event => updateModel(event.target.value)}
                  >
                    {modelSelectOptions.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t("switchEffort")}
                    className="composerInlineSelect effortInlineSelect"
                    title={t("reasoningEffort")}
                    value={modelEffort}
                    onChange={event =>
                      updateModelEffort(event.target.value as ModelEffort)
                    }
                  >
                    {EFFORT_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {effortLabel(option.value, language)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t("switchPermissions")}
                    className="composerInlineSelect permissionsInlineSelect"
                    title={t("permissions")}
                    value={permissionMode}
                    onChange={event =>
                      updatePermissionMode(event.target.value as PermissionMode)
                    }
                  >
                    {PERMISSION_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {permissionLabel(option.value, language)}
                      </option>
                    ))}
                  </select>
                  <button
                    aria-label={isTurnRunning ? t("stopTurn") : t("sendMessage")}
                    className="sendButton"
                    type={isTurnRunning ? "button" : "submit"}
                    disabled={isTurnRunning ? activeTurnId === null : !canSubmit}
                    data-mode={isTurnRunning ? "stop" : "send"}
                    onClick={
                      isTurnRunning
                        ? event => {
                            event.preventDefault();
                            void interruptTurn();
                          }
                        : undefined
                    }
                  >
                    {isTurnRunning ? <Square size={16} /> : <ArrowUp size={18} />}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </section>

      {isNewConversationModalOpen ? (
        <NewConversationModal
          currentWorkspace={workspace}
          language={language}
          workspaces={workspaces}
          onClose={() => setIsNewConversationModalOpen(false)}
          onCreate={createConversationForWorkspace}
        />
      ) : null}

      {isPeriodicTaskModalOpen ? (
        <PeriodicTaskModal
          language={language}
          model={model}
          modelEffort={modelEffort}
          modelOptions={modelSelectOptions}
          permissionMode={permissionMode}
          selectedTaskId={selectedPeriodicTaskId}
          sessionsByWorkspace={workspaceSessions}
          tasks={periodicTasks}
          workspaces={workspaces}
          onClose={() => setIsPeriodicTaskModalOpen(false)}
          onCreateOrUpdate={savePeriodicTask}
          onDelete={deletePeriodicTask}
          onOpenSession={openPeriodicTaskSession}
          onRunNow={runPeriodicTaskNow}
          onToggleEnabled={togglePeriodicTask}
        />
      ) : null}

      {isSettingsOpen ? (
        <SettingsModal
          relayApiKey={relayApiKey}
          relayDeviceId={deviceId}
          relayEndpoint={relayEndpoint}
          relayPresence={relayPresence}
          relayState={relayState}
          relayStatusMessage={relayStatusMessage}
          language={language}
          model={model}
          modelEffort={modelEffort}
          modelOptions={modelSelectOptions}
          notificationSoundFile={notificationSoundFile}
          notificationSoundVolume={notificationSoundVolume}
          permissionMode={permissionMode}
          themeMode={themeMode}
          soundNotificationsEnabled={soundNotificationsEnabled}
          onClose={() => setIsSettingsOpen(false)}
          onChooseNotificationSound={() => void chooseNotificationSound()}
          onClearNotificationSound={clearNotificationSound}
          onLanguageChange={updateLanguage}
          onModelChange={updateModel}
          onModelEffortChange={updateModelEffort}
          onPermissionModeChange={updatePermissionMode}
          onRelayApiKeyChange={updateRelayApiKey}
          onRelayEndpointChange={updateRelayEndpoint}
          onNotificationSoundVolumeChange={updateNotificationSoundVolume}
          onSoundNotificationsEnabledChange={updateSoundNotificationsEnabled}
          onThemeModeChange={updateThemeMode}
        />
      ) : null}
    </main>
  );
}

function NewConversationModal({
  currentWorkspace,
  language,
  workspaces,
  onClose,
  onCreate
}: {
  currentWorkspace: string | null;
  language: UILanguage;
  workspaces: string[];
  onClose: () => void;
  onCreate: (workspace: string) => void;
}) {
  const t = (key: UIMessageKey, values?: Record<string, string | number>) =>
    textFor(language, key, values);
  const defaultWorkspace =
    currentWorkspace && workspaces.includes(currentWorkspace)
      ? currentWorkspace
      : workspaces[0] ?? "";
  const [selectedWorkspace, setSelectedWorkspace] = useState(defaultWorkspace);

  useEffect(() => {
    setSelectedWorkspace(defaultWorkspace);
  }, [defaultWorkspace]);

  return (
    <div className="modalBackdrop" role="presentation">
      <section className="compactModal" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title">
        <div className="modalHeader">
          <div>
            <h2 id="new-conversation-title">{t("newConversation")}</h2>
            <p>{t("chooseConversationWorkspaceBody")}</p>
          </div>
          <button
            aria-label={t("cancel")}
            className="iconOnlyButton"
            type="button"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="compactModalBody">
          <label className="configField">
            <span>{t("chooseConversationWorkspace")}</span>
            <select
              value={selectedWorkspace}
              onChange={event => setSelectedWorkspace(event.target.value)}
            >
              {workspaces.map(cwd => (
                <option key={cwd} value={cwd}>
                  {workspaceName(cwd)}
                </option>
              ))}
            </select>
          </label>
          <div className="modalActions">
            <button className="miniButton" type="button" onClick={onClose}>
              {t("cancel")}
            </button>
            <button
              className="approveButton"
              disabled={!selectedWorkspace}
              type="button"
              onClick={() => onCreate(selectedWorkspace)}
            >
              <Plus size={14} />
              <span>{t("createConversation")}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function AutomationSidebar({
  language,
  selectedTaskId,
  tasks,
  onNewTask,
  onOpenTask
}: {
  language: UILanguage;
  selectedTaskId: string | null;
  tasks: PeriodicTask[];
  onNewTask: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const t = (key: UIMessageKey, values?: Record<string, string | number>) =>
    textFor(language, key, values);

  return (
    <div className="automationPanel">
      <div className="automationHeader">
        <div>
          <strong>{t("periodicTasks")}</strong>
          <span>{t("taskCount", { count: tasks.length })}</span>
        </div>
        <button className="miniButton primaryMiniButton" type="button" onClick={onNewTask}>
          <Plus size={14} />
          <span>{t("newTask")}</span>
        </button>
      </div>
      {tasks.length === 0 ? (
        <div className="emptyTree">
          <p>{t("noTasksBody")}</p>
        </div>
      ) : (
        <div className="automationList" role="list">
          {tasks.map(task => (
            <button
              className="automationListItem"
              data-active={task.id === selectedTaskId}
              data-trigger={task.trigger}
              key={task.id}
              role="listitem"
              type="button"
              onClick={() => onOpenTask(task.id)}
            >
              <span className="automationTypeIcon" aria-hidden="true">
                {task.trigger === "schedule" ? <CalendarClock size={14} /> : <RotateCw size={14} />}
              </span>
              <span className="automationListTitle">
                <strong>{task.name}</strong>
                <small>{workspaceName(task.workspace)}</small>
              </span>
              <span className="taskStatusPill" data-status={task.status}>
                {periodicTaskStatusLabel(task, language)}
              </span>
              <span className="automationTriggerLine">
                <span className="automationTriggerPill" data-trigger={task.trigger}>
                  {task.trigger === "schedule"
                    ? t("taskTypeSchedule")
                    : t("taskTypeInterval")}
                </span>
                <span>{periodicTaskTriggerLabel(task, language)}</span>
              </span>
              <span className="automationNextRun">
                {t("nextRun")}: {task.nextRunAt ? formatTaskTime(task.nextRunAt) : "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PeriodicTaskModal({
  language,
  model,
  modelEffort,
  modelOptions,
  permissionMode,
  selectedTaskId,
  sessionsByWorkspace,
  tasks,
  workspaces,
  onClose,
  onCreateOrUpdate,
  onDelete,
  onOpenSession,
  onRunNow,
  onToggleEnabled
}: {
  language: UILanguage;
  model: string;
  modelEffort: ModelEffort;
  modelOptions: ModelOption[];
  permissionMode: PermissionMode;
  selectedTaskId: string | null;
  sessionsByWorkspace: Record<string, SessionView[]>;
  tasks: PeriodicTask[];
  workspaces: string[];
  onClose: () => void;
  onCreateOrUpdate: (input: PeriodicTaskInput, taskId?: string | null) => void | Promise<void>;
  onDelete: (task: PeriodicTask) => void | Promise<void>;
  onOpenSession: (task: PeriodicTask) => void;
  onRunNow: (task: PeriodicTask) => void | Promise<void>;
  onToggleEnabled: (task: PeriodicTask) => void | Promise<void>;
}) {
  const t = (key: UIMessageKey, values?: Record<string, string | number>) =>
    textFor(language, key, values);
  const selectedTask = tasks.find(task => task.id === selectedTaskId) ?? null;
  const defaultWorkspace = selectedTask?.workspace ?? workspaces[0] ?? "";
  const [draft, setDraft] = useState<PeriodicTaskInput>(() =>
    periodicTaskDraftFromTask(selectedTask, {
      workspace: defaultWorkspace,
      model,
      modelEffort,
      permissionMode
    })
  );
  const [draftTaskId, setDraftTaskId] = useState<string | null>(selectedTask?.id ?? null);

  useEffect(() => {
    const nextTask = tasks.find(task => task.id === selectedTaskId) ?? null;
    const nextWorkspace = nextTask?.workspace ?? workspaces[0] ?? "";
    setDraftTaskId(nextTask?.id ?? null);
    setDraft(periodicTaskDraftFromTask(nextTask, {
      workspace: nextWorkspace,
      model,
      modelEffort,
      permissionMode
    }));
  }, [model, modelEffort, permissionMode, selectedTaskId, tasks, workspaces]);

  const workspaceSessions = draft.workspace
    ? sessionsByWorkspace[draft.workspace] ?? []
    : [];
  const draftTrigger = draft.trigger ?? "interval";
  const draftScheduleFrequency = draft.scheduleFrequency ?? "daily";
  const draftScheduleWeekdays = draft.scheduleWeekdays ?? [1];
  const canSubmit =
    draft.name.trim().length > 0 &&
    draft.workspace.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    (draft.sessionMode !== "existing" || Boolean(draft.sessionId)) &&
    (draftTrigger !== "schedule" ||
      draftScheduleFrequency !== "weekly" ||
      draftScheduleWeekdays.length > 0);

  function updateDraft(patch: Partial<PeriodicTaskInput>) {
    setDraft(current => ({ ...current, ...patch }));
  }

  function toggleDraftWeekday(value: number) {
    const nextWeekdays = draftScheduleWeekdays.includes(value)
      ? draftScheduleWeekdays.filter(item => item !== value)
      : [...draftScheduleWeekdays, value].sort((a, b) => a - b);
    updateDraft({ scheduleWeekdays: nextWeekdays });
  }

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    void onCreateOrUpdate(draft, draftTaskId);
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <section
        className="taskEditorPane taskModal"
        role="dialog"
        aria-modal="true"
        aria-label={draftTaskId ? t("saveTask") : t("createTask")}
      >
        <form className="taskEditorForm" onSubmit={submitTask}>
          <div className="taskEditorHeader">
            <div>
              <h3>{draftTaskId ? draft.name || t("editTask") : t("newTask")}</h3>
              <p>{t("periodicTasksIntro")}</p>
            </div>
            <div className="taskEditorHeaderActions">
              {draftTaskId ? (
                <span className="taskStatusPill" data-status={selectedTask?.status ?? "idle"}>
                  {selectedTask ? periodicTaskStatusLabel(selectedTask, language) : "idle"}
                </span>
              ) : null}
              <button
                aria-label={t("cancel")}
                className="iconOnlyButton"
                type="button"
                onClick={onClose}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="taskFormGrid">
            <label className="configField">
              <span>{t("taskName")}</span>
              <input
                value={draft.name}
                onChange={event => updateDraft({ name: event.target.value })}
                placeholder="GitHub issue monitor"
              />
            </label>

            <label className="configField">
              <span>{t("targetWorkspace")}</span>
              <select
                value={draft.workspace}
                onChange={event => {
                  const nextWorkspace = event.target.value;
                  updateDraft({
                    workspace: nextWorkspace,
                    sessionId:
                      draft.sessionMode === "existing"
                        ? sessionsByWorkspace[nextWorkspace]?.[0]?.threadId
                        : undefined
                  });
                }}
              >
                {workspaces.length === 0 ? (
                  <option value="">No workspace</option>
                ) : null}
                {workspaces.map(cwd => (
                  <option key={cwd} value={cwd}>
                    {workspaceName(cwd)}
                  </option>
                ))}
              </select>
            </label>

            <label className="configField">
              <span>{t("sessionMode")}</span>
              <select
                value={draft.sessionMode}
                onChange={event => {
                  const sessionMode = event.target.value as "existing" | "create_once";
                  updateDraft({
                    sessionMode,
                    sessionId:
                      sessionMode === "existing"
                        ? workspaceSessions[0]?.threadId
                        : undefined
                  });
                }}
              >
                <option value="create_once">{t("dedicatedSession")}</option>
                <option value="existing">{t("existingSession")}</option>
              </select>
            </label>

            {draft.sessionMode === "existing" ? (
              <label className="configField">
                <span>{t("targetSession")}</span>
                <select
                  value={draft.sessionId ?? ""}
                  onChange={event => updateDraft({ sessionId: event.target.value })}
                >
                  {workspaceSessions.length === 0 ? (
                    <option value="">No sessions loaded</option>
                  ) : null}
                  {workspaceSessions.map(item => (
                    <option key={item.threadId} value={item.threadId}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="configField">
              <span>{t("triggerType")}</span>
              <select
                value={draftTrigger}
                onChange={event =>
                  updateDraft({ trigger: event.target.value as "interval" | "schedule" })
                }
              >
                <option value="interval">{t("triggerInterval")}</option>
                <option value="schedule">{t("triggerSchedule")}</option>
              </select>
            </label>

            {draftTrigger === "schedule" ? (
              <>
                <label className="configField">
                  <span>{t("scheduleFrequency")}</span>
                  <select
                    value={draftScheduleFrequency}
                    onChange={event =>
                      updateDraft({ scheduleFrequency: event.target.value as "daily" | "weekly" })
                    }
                  >
                    <option value="daily">{t("scheduleDaily")}</option>
                    <option value="weekly">{t("scheduleWeekly")}</option>
                  </select>
                </label>

                <label className="configField">
                  <span>{t("scheduleTime")}</span>
                  <input
                    type="time"
                    value={draft.scheduleTime ?? "09:00"}
                    onChange={event => updateDraft({ scheduleTime: event.target.value })}
                  />
                </label>

                {draftScheduleFrequency === "weekly" ? (
                  <div className="taskWeekdayField">
                    <span>{t("scheduleWeekdays")}</span>
                    <div className="weekdayPicker" role="group" aria-label={t("scheduleWeekdays")}>
                      {WEEKDAY_OPTIONS.map(option => (
                        <button
                          className="weekdayButton"
                          data-active={draftScheduleWeekdays.includes(option.value)}
                          key={option.value}
                          type="button"
                          onClick={() => toggleDraftWeekday(option.value)}
                        >
                          {language === "zh-CN" ? option.zh : option.en}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <label className="configField">
                <span>{t("intervalMinutes")}</span>
                <input
                  min={1}
                  step={1}
                  type="number"
                  value={Math.max(1, Math.round(draft.intervalMs / 60_000))}
                  onChange={event =>
                    updateDraft({ intervalMs: Math.max(1, Number(event.target.value) || 1) * 60_000 })
                  }
                />
              </label>
            )}

            <label className="configField">
              <span>{t("model")}</span>
              <select
                value={draft.model ?? model}
                onChange={event => updateDraft({ model: event.target.value })}
              >
                {modelOptions.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="configField">
              <span>{t("reasoningEffort")}</span>
              <select
                value={String(draft.effort ?? modelEffort)}
                onChange={event => updateDraft({ effort: event.target.value })}
              >
                {EFFORT_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {effortLabel(option.value, language)}
                  </option>
                ))}
              </select>
            </label>

            <label className="configField">
              <span>{t("permissions")}</span>
              <select
                value={draft.permissionMode ?? permissionMode}
                onChange={event =>
                  updateDraft({ permissionMode: event.target.value as PermissionMode })
                }
              >
                {PERMISSION_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {permissionLabel(option.value, language)}
                  </option>
                ))}
              </select>
            </label>
            <label className="configField taskPromptField">
              <span>{t("taskPrompt")}</span>
              <textarea
                value={draft.prompt}
                onChange={event => updateDraft({ prompt: event.target.value })}
                placeholder={defaultPeriodicTaskPrompt()}
              />
            </label>

            <label className="toggleField taskToggleField">
              <input
                checked={draft.enabled ?? true}
                onChange={event => updateDraft({ enabled: event.target.checked })}
                type="checkbox"
              />
              <span>
                <strong>{t("enabled")}</strong>
                <small>{t("periodicTasksIntro")}</small>
              </span>
            </label>

            {selectedTask ? (
              <div className="taskRunSummary">
                <span>{t("lastRun")}</span>
                <strong>{selectedTask.lastRunAt ? formatTaskTime(selectedTask.lastRunAt) : "—"}</strong>
                <span>{t("nextRun")}</span>
                <strong>{selectedTask.nextRunAt ? formatTaskTime(selectedTask.nextRunAt) : "—"}</strong>
                {selectedTask.lastError ? (
                  <>
                    <span>Error</span>
                    <strong>{selectedTask.lastError}</strong>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="taskEditorActions">
            <button className="approveButton" disabled={!canSubmit} type="submit">
              <Check size={14} />
              <span>{draftTaskId ? t("saveTask") : t("createTask")}</span>
            </button>
            {selectedTask ? (
              <>
                <button
                  className="miniButton"
                  disabled={selectedTask.status === "running"}
                  type="button"
                  onClick={() => void onRunNow(selectedTask)}
                >
                  <Play size={14} />
                  <span>{t("runNow")}</span>
                </button>
                <button className="miniButton" type="button" onClick={() => void onToggleEnabled(selectedTask)}>
                  {selectedTask.enabled ? <Pause size={14} /> : <RotateCw size={14} />}
                  <span>{selectedTask.enabled ? t("pause") : t("resume")}</span>
                </button>
                <button
                  className="miniButton"
                  disabled={!selectedTask.sessionId}
                  type="button"
                  onClick={() => onOpenSession(selectedTask)}
                >
                  <ChevronRight size={14} />
                  <span>{t("openTaskSession")}</span>
                </button>
                <button className="declineButton" type="button" onClick={() => void onDelete(selectedTask)}>
                  <Trash2 size={14} />
                  <span>{t("deleteTask")}</span>
                </button>
              </>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}

function SidebarOptionMenu({
  icon,
  label,
  options,
  value,
  onChange
}: {
  icon: ReactNode;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  function closeMenu() {
    detailsRef.current?.removeAttribute("open");
  }

  return (
    <details className="sidebarOptionMenu" ref={detailsRef}>
      <summary>
        {icon}
        <span>{label}</span>
      </summary>
      <div className="sidebarOptionPopover">
        {options.map(option => (
          <button
            data-active={option.value === value}
            key={option.value}
            type="button"
            onClick={() => {
              onChange(option.value);
              closeMenu();
            }}
          >
            <span>{option.label}</span>
            {option.value === value ? <Check size={13} /> : null}
          </button>
        ))}
      </div>
    </details>
  );
}

function RateLimitRing({
  label,
  shortLabel,
  value,
  fallback
}: {
  label: string;
  shortLabel: string;
  value: number | null;
  fallback: string;
}) {
  const percent = value === null ? 0 : value;
  const display = value === null ? "—" : `${Math.round(value)}%`;
  const tone =
    value === null ? "unknown" : value <= 20 ? "low" : value <= 50 ? "medium" : "high";
  const style = {
    "--rate-value": `${percent * 3.6}deg`
  } as CSSProperties;

  return (
    <div
      aria-label={`${label}: ${value === null ? fallback : display}`}
      className="rateLimitRing"
      data-tone={tone}
      role="meter"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={value ?? 0}
    >
      <div className="rateLimitCircle" style={style}>
        <span>{shortLabel}</span>
      </div>
      <strong>{display}</strong>
    </div>
  );
}

function WorkspaceActionMenu({
  disabled,
  language,
  workspaceName,
  onNewSession,
  onRemove
}: {
  disabled: boolean;
  language: UILanguage;
  workspaceName: string;
  onNewSession: () => void;
  onRemove: () => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const t = (key: UIMessageKey, values?: Record<string, string | number>) =>
    textFor(language, key, values);

  function closeMenu() {
    detailsRef.current?.removeAttribute("open");
  }

  return (
    <details className="workspaceActionMenu" ref={detailsRef}>
      <summary aria-label={t("workspaceActions", { name: workspaceName })}>
        <MoreHorizontal size={15} />
      </summary>
      <div className="workspaceActionPopover">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            closeMenu();
            onNewSession();
          }}
        >
          <Plus size={14} />
          <span>{t("newSession")}</span>
        </button>
        <button
          className="dangerMenuItem"
          type="button"
          onClick={() => {
            closeMenu();
            onRemove();
          }}
        >
          <Trash2 size={14} />
          <span>{t("removeWorkspace")}</span>
        </button>
      </div>
    </details>
  );
}

function SessionTreeRow({
  active,
  item,
  language,
  meta,
  unread,
  working,
  onOpen,
  onRemove,
  onRename
}: {
  active: boolean;
  item: SessionView;
  language: UILanguage;
  meta?: string;
  unread: boolean;
  working: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onRename: (title: string) => void | Promise<void>;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.title);
  const t = (key: UIMessageKey, values?: Record<string, string | number>) =>
    textFor(language, key, values);

  useEffect(() => {
    if (!isRenaming) {
      setDraftTitle(item.title);
    }
  }, [isRenaming, item.title]);

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = draftTitle.trim();
    if (nextTitle && nextTitle !== item.title) {
      void onRename(nextTitle);
    }
    setIsRenaming(false);
  }

  function cancelRename() {
    setDraftTitle(item.title);
    setIsRenaming(false);
  }

  return (
    <div
      className="sessionChild"
      data-active={active}
      data-renaming={isRenaming}
      data-working={working}
    >
      {isRenaming ? (
        <form className="sessionRenameForm" onSubmit={submitRename}>
          <input
            aria-label={t("sessionName")}
            autoFocus
            value={draftTitle}
            onChange={event => setDraftTitle(event.target.value)}
            onFocus={event => event.target.select()}
            onKeyDown={event => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
          />
          <button aria-label={t("saveSessionName")} className="treeIconButton" type="submit">
            <Check size={14} />
          </button>
          <button
            aria-label={t("cancelRename")}
            className="treeIconButton"
            type="button"
            onClick={cancelRename}
          >
            <X size={14} />
          </button>
        </form>
      ) : (
        <>
          <button
            className="sessionOpenButton"
            title={item.title}
            type="button"
            onClick={onOpen}
          >
            <ChevronRight size={13} />
            <span className="sessionTitleText">{item.title}</span>
            <small>{meta ?? sessionMeta(item)}</small>
            {unread ? <span className="sessionUnreadDot" aria-label={t("unreadTurn")} /> : null}
          </button>
          <button
            aria-label={t("renameSession", { title: item.title })}
            className="treeIconButton"
            type="button"
            onClick={() => setIsRenaming(true)}
          >
            <Pencil size={14} />
          </button>
          <button
            aria-label={t("removeSession", { title: item.title })}
            className="treeIconButton dangerIconButton"
            type="button"
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
    </div>
  );
}

function SettingsModal({
  model,
  modelEffort,
  modelOptions,
  notificationSoundFile,
  notificationSoundVolume,
  permissionMode,
  relayApiKey,
  relayDeviceId,
  relayEndpoint,
  relayPresence,
  relayState,
  relayStatusMessage,
  language,
  soundNotificationsEnabled,
  themeMode,
  onClose,
  onChooseNotificationSound,
  onClearNotificationSound,
  onLanguageChange,
  onModelChange,
  onModelEffortChange,
  onNotificationSoundVolumeChange,
  onPermissionModeChange,
  onRelayApiKeyChange,
  onRelayEndpointChange,
  onSoundNotificationsEnabledChange,
  onThemeModeChange
}: {
  model: string;
  modelEffort: ModelEffort;
  modelOptions: ModelOption[];
  notificationSoundFile: NotificationSoundFile | null;
  notificationSoundVolume: number;
  permissionMode: PermissionMode;
  relayApiKey: string;
  relayDeviceId: string;
  relayEndpoint: string;
  relayPresence: RelayPresence | null;
  relayState: RelayConnectionState;
  relayStatusMessage: string;
  language: UILanguage;
  soundNotificationsEnabled: boolean;
  themeMode: ThemeMode;
  onClose: () => void;
  onChooseNotificationSound: () => void;
  onClearNotificationSound: () => void;
  onLanguageChange: (value: UILanguage) => void;
  onModelChange: (value: string) => void;
  onModelEffortChange: (value: ModelEffort) => void;
  onNotificationSoundVolumeChange: (value: number) => void;
  onPermissionModeChange: (value: PermissionMode) => void;
  onRelayApiKeyChange: (value: string) => void;
  onRelayEndpointChange: (value: string) => void;
  onSoundNotificationsEnabledChange: (value: boolean) => void;
  onThemeModeChange: (value: ThemeMode) => void;
}) {
  const [copiedField, setCopiedField] = useState<"apiKey" | "deviceId" | null>(null);
  const t = (key: UIMessageKey, values?: Record<string, string | number>) =>
    textFor(language, key, values);

  async function copySettingValue(field: "apiKey" | "deviceId", value: string) {
    if (!value) {
      return;
    }

    try {
      await copyTextToClipboard(value);
      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField(current => (current === field ? null : current));
      }, 1600);
    } catch {
      setCopiedField(null);
    }
  }

  return (
    <div
      className="modalBackdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settingsModal"
        role="dialog"
      >
        <header className="modalHeader">
          <div>
            <h2 id="settings-title">{t("settings")}</h2>
            <p>{t("settingsIntro")}</p>
          </div>
          <button
            aria-label={t("closeSettings")}
            className="iconOnlyButton"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </header>

        <div className="settingsModalBody">
          <section className="settingsSection" aria-labelledby="appearance-settings-title">
            <div>
              <h3 id="appearance-settings-title">{t("appearance")}</h3>
              <p>{t("appearanceIntro")}</p>
            </div>

            <label className="configField">
              <span>{t("theme")}</span>
              <select
                value={themeMode}
                onChange={event => onThemeModeChange(event.target.value as ThemeMode)}
              >
                <option value="dark">{t("dark")}</option>
                <option value="light">{t("light")}</option>
              </select>
            </label>

            <label className="configField">
              <span>{t("language")}</span>
              <select
                value={language}
                onChange={event => onLanguageChange(event.target.value as UILanguage)}
              >
                {LANGUAGE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="settingsSection" aria-labelledby="notification-settings-title">
            <div>
              <h3 id="notification-settings-title">{t("notifications")}</h3>
              <p>{t("notificationsIntro")}</p>
            </div>

            <label className="toggleField">
              <input
                checked={soundNotificationsEnabled}
                onChange={event =>
                  onSoundNotificationsEnabledChange(event.target.checked)
                }
                type="checkbox"
              />
              <span>
                <strong>{t("soundOnTurnCompletion")}</strong>
                <small>{t("soundOnTurnCompletionHelp")}</small>
              </span>
            </label>

            <label className="soundVolumeControl">
              <span>{t("soundVolume")}</span>
              <input
                aria-valuetext={`${notificationSoundVolume}%`}
                max={100}
                min={0}
                step={1}
                type="range"
                value={notificationSoundVolume}
                onChange={event =>
                  onNotificationSoundVolumeChange(Number(event.target.value))
                }
              />
              <strong>{notificationSoundVolume}%</strong>
            </label>

            <div className="soundFilePicker">
              <div>
                <span>{t("audioFile")}</span>
                <strong>
                  {notificationSoundFile?.name ?? DEFAULT_NOTIFICATION_SOUND_FILE.name}
                </strong>
                {notificationSoundFile ? <small>{notificationSoundFile.path}</small> : null}
              </div>
              <div className="soundFileActions">
                <button className="miniButton" type="button" onClick={onChooseNotificationSound}>
                  {t("chooseFile")}
                </button>
                <button
                  className="miniButton"
                  disabled={!notificationSoundFile}
                  type="button"
                  onClick={onClearNotificationSound}
                >
                  {t("clear")}
                </button>
              </div>
            </div>
          </section>

          <section className="settingsSection" aria-labelledby="model-settings-title">
            <div>
              <h3 id="model-settings-title">{t("model")}</h3>
              <p>{t("modelIntro")}</p>
            </div>

            <label className="configField">
              <span>{t("model")}</span>
              <select
                value={model}
                onChange={event => onModelChange(event.target.value)}
              >
                {modelOptions.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="configField">
              <span>{t("reasoningLevel")}</span>
              <select
                value={modelEffort}
                onChange={event =>
                  onModelEffortChange(event.target.value as ModelEffort)
                }
              >
                {EFFORT_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {effortLabel(option.value, language)}
                  </option>
                ))}
              </select>
            </label>

            <div className="permissionDescription">
              <strong>{effortLabel(modelEffort, language)}</strong>
              <span>{effortDescription(modelEffort, language)}</span>
            </div>
          </section>

          <section className="settingsSection" aria-labelledby="permissions-settings-title">
            <div>
              <h3 id="permissions-settings-title">{t("permissions")}</h3>
              <p>{t("permissionsIntro")}</p>
            </div>

            <label className="configField">
              <span>{t("defaultPermissions")}</span>
              <select
                value={permissionMode}
                onChange={event =>
                  onPermissionModeChange(event.target.value as PermissionMode)
                }
              >
                {PERMISSION_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {permissionLabel(option.value, language)}
                  </option>
                ))}
              </select>
            </label>

            <div className="permissionDescription">
              <strong>{permissionLabel(permissionMode, language)}</strong>
              <span>{permissionDescription(permissionMode, language)}</span>
            </div>
          </section>

          <section className="settingsSection" aria-labelledby="relay-settings-title">
            <div>
              <h3 id="relay-settings-title">{t("relay")}</h3>
              <p>{t("relayIntro")}</p>
            </div>

            <label className="configField">
              <span>{t("endpoint")}</span>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                onChange={event => onRelayEndpointChange(event.target.value)}
                placeholder="ws://server:8909"
                spellCheck={false}
                value={relayEndpoint}
              />
            </label>

            <label className="configField">
              <span>{t("apiKey")}</span>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                onChange={event => onRelayApiKeyChange(event.target.value)}
                placeholder="cp_..."
                spellCheck={false}
                type="password"
                value={relayApiKey}
              />
            </label>
          </section>

          <section className="settingsSection" aria-labelledby="relay-status-title">
            <div>
              <h3 id="relay-status-title">{t("status")}</h3>
              <p>{relayStatusMessage}</p>
            </div>
            <div className="settingsSummary">
              <span>{t("endpoint")}</span>
              <code>{relayEndpoint || t("notSet")}</code>
              <span>{t("deviceId")}</span>
              <div className="settingsSummaryValue">
                <code>{relayDeviceId}</code>
                <button
                  aria-label={t("copyDeviceId")}
                  className="copyValueButton"
                  type="button"
                  onClick={() => void copySettingValue("deviceId", relayDeviceId)}
                >
                  {copiedField === "deviceId" ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedField === "deviceId" ? t("copied") : t("copy")}</span>
                </button>
              </div>
              <span>{t("desktopUrl")}</span>
              <code>
                {relayEndpoint && relayApiKey
                  ? relayWebSocketURL(relayEndpoint, "desktop", relayDeviceId, "***")
                  : t("notReady")}
              </code>
              <span>{t("apiKey")}</span>
              <div className="settingsSummaryValue">
                <strong>{relayApiKey ? t("saved") : t("missing")}</strong>
                <button
                  aria-label={t("copyApiKey")}
                  className="copyValueButton"
                  disabled={!relayApiKey}
                  type="button"
                  onClick={() => void copySettingValue("apiKey", relayApiKey)}
                >
                  {copiedField === "apiKey" ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedField === "apiKey" ? t("copied") : t("copy")}</span>
                </button>
              </div>
              <span>{t("connection")}</span>
              <strong>{relayState}</strong>
              <span>{t("mobileClients")}</span>
              <strong>{relayPresence ? relayPresence.clientCount : 0}</strong>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Unable to copy text.");
  }
}

function storedDeviceId(): string {
  const existing = window.localStorage.getItem(RELAY_DEVICE_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const next =
    typeof crypto.randomUUID === "function"
      ? `desktop-${crypto.randomUUID()}`
      : `desktop-${Date.now().toString(36)}`;
  window.localStorage.setItem(RELAY_DEVICE_ID_STORAGE_KEY, next);
  return next;
}

function readSavedPermissionMode(): PermissionMode {
  const saved = window.localStorage.getItem(PERMISSIONS_STORAGE_KEY);
  if (isPermissionMode(saved)) {
    return saved;
  }
  if (saved === "never" || saved === "danger-full-access") {
    return "full-access";
  }
  if (saved === "on-request" || saved === "on-failure" || saved === "untrusted") {
    return "default";
  }
  return "default";
}

function readSavedThemeMode(): ThemeMode {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" ? "light" : "dark";
}

function readSavedLanguage(): UILanguage {
  const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return saved === "en" || saved === "zh-CN" ? saved : "zh-CN";
}

function readSavedRelayEndpoint(): string {
  const saved = window.localStorage.getItem(RELAY_ENDPOINT_STORAGE_KEY);
  const endpoint =
    !saved || isLegacyDefaultRelayEndpoint(saved) ? CLOUD_RELAY_ENDPOINT : saved.trim();
  if (saved !== endpoint) {
    window.localStorage.setItem(RELAY_ENDPOINT_STORAGE_KEY, endpoint);
  }
  return endpoint;
}

function isLegacyDefaultRelayEndpoint(value: string): boolean {
  const normalized = value.trim().replace(/\/+$/, "").toLowerCase();
  return (
    normalized === "ws://127.0.0.1:8909" ||
    normalized === "ws://localhost:8909" ||
    normalized === "ws://:8909" ||
    normalized === "wss://tx-bridge.three.ink" ||
    normalized === "https://tx-bridge.three.ink" ||
    normalized === "https://codex-bridge.three.ink"
  );
}

function readSavedModel(): string {
  return window.localStorage.getItem(MODEL_STORAGE_KEY) ?? "gpt-5.5";
}

function readSavedModelEffort(): ModelEffort {
  const saved = window.localStorage.getItem(MODEL_EFFORT_STORAGE_KEY);
  return isModelEffort(saved) ? saved : "high";
}

function readSavedNotificationSoundFile(): NotificationSoundFile | null {
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_SOUND_FILE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const record = asRecord(parsed);
    const file = {
      path: stringOrUndefined(record.path),
      url: stringOrUndefined(record.url),
      name: stringOrUndefined(record.name)
    };
    if (file.path && file.url && file.name) {
      return file as NotificationSoundFile;
    }
  } catch {
    // Ignore malformed localStorage.
  }
  return null;
}

function readSavedNotificationSoundVolume(): number {
  const saved = Number(window.localStorage.getItem(NOTIFICATION_SOUND_VOLUME_STORAGE_KEY));
  return Number.isFinite(saved)
    ? clampPercent(Math.round(saved))
    : DEFAULT_NOTIFICATION_SOUND_VOLUME;
}

async function playFallbackNotificationTone(volume: number): Promise<void> {
  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  const peakVolume = 0.18 * (clampPercent(volume) / 100);
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(peakVolume, 0.0001),
    audioContext.currentTime + 0.012
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.22);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.24);
  await new Promise<void>(resolve => {
    oscillator.addEventListener("ended", () => resolve(), { once: true });
  });
  await audioContext.close();
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "default" || value === "auto-review" || value === "full-access";
}

function isModelEffort(value: unknown): value is ModelEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function permissionLabel(value: PermissionMode, language: UILanguage = "en"): string {
  if (value === "default") {
    return textFor(language, "defaultPermissionLabel");
  }
  if (value === "auto-review") {
    return textFor(language, "autoReviewPermissionLabel");
  }
  return textFor(language, "fullAccessPermissionLabel");
}

function permissionDescription(value: PermissionMode, language: UILanguage = "en"): string {
  if (value === "default") {
    return textFor(language, "defaultPermissionDescription");
  }
  if (value === "auto-review") {
    return textFor(language, "autoReviewPermissionDescription");
  }
  return textFor(language, "fullAccessPermissionDescription");
}

function effortLabel(value: ModelEffort, language: UILanguage = "en"): string {
  if (value === "low") {
    return textFor(language, "effortLowLabel");
  }
  if (value === "medium") {
    return textFor(language, "effortMediumLabel");
  }
  if (value === "high") {
    return textFor(language, "effortHighLabel");
  }
  return textFor(language, "effortXHighLabel");
}

function effortDescription(value: ModelEffort, language: UILanguage = "en"): string {
  if (value === "low") {
    return textFor(language, "effortLowDescription");
  }
  if (value === "medium") {
    return textFor(language, "effortMediumDescription");
  }
  if (value === "high") {
    return textFor(language, "effortHighDescription");
  }
  return textFor(language, "effortXHighDescription");
}

function codexModelOptions(model: string, effort: ModelEffort): {
  model: string;
  effort: ModelEffort;
} {
  return { model, effort };
}

function contextUsageFromNotification(params: unknown): ContextUsage | null {
  const tokenUsage = asRecord(asRecord(params).tokenUsage);
  const current = asRecord(tokenUsage.last);
  const fallbackTotal = asRecord(tokenUsage.total);
  const usedTokens =
    numberOrNull(current.totalTokens) ?? numberOrNull(fallbackTotal.totalTokens);
  const contextWindow = numberOrNull(tokenUsage.modelContextWindow);
  if (usedTokens === null) {
    return null;
  }
  return { usedTokens, contextWindow };
}

function rateLimitUsageFromUnknown(value: unknown): RateLimitUsage | null {
  const rateLimits = findRateLimitsRecord(value, 0);
  if (!rateLimits) {
    return null;
  }

  const primary = rateLimitWindowFromRecord(asRecord(rateLimits.primary));
  const secondary = rateLimitWindowFromRecord(asRecord(rateLimits.secondary));
  if (!primary && !secondary) {
    return null;
  }

  return { primary, secondary };
}

function findRateLimitsRecord(
  value: unknown,
  depth: number
): Record<string, unknown> | null {
  if (depth > 4) {
    return null;
  }

  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return null;
  }

  const direct =
    asRecord(record.rateLimits).primary || asRecord(record.rateLimits).secondary
      ? asRecord(record.rateLimits)
      : asRecord(record.rate_limits).primary || asRecord(record.rate_limits).secondary
        ? asRecord(record.rate_limits)
        : null;
  if (direct) {
    return direct;
  }

  if (record.primary || record.secondary) {
    return record;
  }

  for (const child of Object.values(record)) {
    const found = findRateLimitsRecord(child, depth + 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function rateLimitWindowFromRecord(
  record: Record<string, unknown>
): RateLimitWindowUsage | null {
  const remainingPercent = firstNumber(
    record.remaining_percent,
    record.remainingPercent,
    record.left_percent,
    record.leftPercent
  );
  if (remainingPercent !== null) {
    return { leftPercent: clampPercent(remainingPercent) };
  }

  const usedPercent = firstNumber(record.used_percent, record.usedPercent);
  if (usedPercent === null) {
    return null;
  }

  return { leftPercent: clampPercent(100 - usedPercent) };
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function contextLabel(usage: ContextUsage | null, language: UILanguage = "en"): string {
  if (!usage) {
    return textFor(language, "contextUnknown");
  }
  if (usage.contextWindow && usage.contextWindow > 0) {
    const remaining = Math.max(usage.contextWindow - usage.usedTokens, 0);
    return textFor(language, "contextLeft", { value: formatTokenCount(remaining) });
  }
  return textFor(language, "contextUsed", { value: formatTokenCount(usage.usedTokens) });
}

function contextTooltip(usage: ContextUsage | null, language: UILanguage = "en"): string {
  if (!usage) {
    return textFor(language, "contextUnknownTooltip");
  }
  if (usage.contextWindow && usage.contextWindow > 0) {
    const remaining = Math.max(usage.contextWindow - usage.usedTokens, 0);
    const percent = Math.round((remaining / usage.contextWindow) * 100);
    return textFor(language, "contextRemainingTooltip", {
      remaining: formatTokenCount(remaining),
      total: formatTokenCount(usage.contextWindow),
      percent
    });
  }
  return textFor(language, "contextUsedTooltip", {
    value: formatTokenCount(usage.usedTokens)
  });
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 100) / 10}K`;
  }
  return String(value);
}

function formatTurnDuration(milliseconds: number): string {
  const totalSeconds = Math.max(Math.floor(milliseconds / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function periodicTaskDraftFromTask(
  task: PeriodicTask | null,
  fallback: {
    workspace: string;
    model: string;
    modelEffort: ModelEffort;
    permissionMode: PermissionMode;
  }
): PeriodicTaskInput {
  if (task) {
    return {
      name: task.name,
      enabled: task.enabled,
      workspace: task.workspace,
      sessionMode: task.sessionMode,
      sessionId: task.sessionId,
      prompt: task.prompt,
      trigger: task.trigger,
      intervalMs: task.intervalMs,
      scheduleFrequency: task.scheduleFrequency,
      scheduleTime: task.scheduleTime,
      scheduleWeekdays: task.scheduleWeekdays,
      model: task.model,
      effort: task.effort,
      permissionMode: task.permissionMode
    };
  }

  return {
    name: "",
    enabled: true,
    workspace: fallback.workspace,
    sessionMode: "create_once",
    prompt: defaultPeriodicTaskPrompt(),
    trigger: "interval",
    intervalMs: 5 * 60_000,
    scheduleFrequency: "daily",
    scheduleTime: "09:00",
    scheduleWeekdays: [1],
    model: fallback.model,
    effort: fallback.modelEffort,
    permissionMode: fallback.permissionMode
  };
}

function defaultPeriodicTaskPrompt(): string {
  return [
    "Check GitHub issues for this repository.",
    "",
    "Rules:",
    "- Look for open issues that are actionable.",
    "- Pick at most one issue per run.",
    "- Before editing, summarize the chosen issue and plan.",
    "- Implement the fix, run relevant tests, and report the result.",
    "- If nothing needs action, say so briefly and stop.",
    "- Keep a local note of handled issue IDs in .codex-plus/periodic/github-issues.json."
  ].join("\n");
}

function periodicTaskStatusLabel(task: PeriodicTask, language: UILanguage): string {
  if (!task.enabled && task.status !== "running") {
    return textFor(language, "pause");
  }
  if (task.status === "running") {
    return textFor(language, "working");
  }
  if (task.status === "error") {
    return "Error";
  }
  if (task.status === "waiting") {
    return textFor(language, "ready");
  }
  return task.status;
}

function periodicTaskTriggerLabel(task: PeriodicTask, language: UILanguage): string {
  if (task.trigger !== "schedule") {
    const minutes = Math.max(1, Math.round(task.intervalMs / 60_000));
    return language === "zh-CN" ? `完成后 ${minutes} 分钟` : `${minutes}m after completion`;
  }

  if (task.scheduleFrequency === "daily") {
    return language === "zh-CN"
      ? `每天 ${task.scheduleTime}`
      : `Daily ${task.scheduleTime}`;
  }

  const days = WEEKDAY_OPTIONS
    .filter(option => task.scheduleWeekdays.includes(option.value))
    .map(option => language === "zh-CN" ? option.zh : option.en)
    .join(language === "zh-CN" ? "、" : ", ");
  return language === "zh-CN"
    ? `每周 ${days || "周一"} ${task.scheduleTime}`
    : `Weekly ${days || "Mon"} ${task.scheduleTime}`;
}

function formatTaskTime(value: number): string {
  return new Date(value).toLocaleString();
}

function codexPermissionOptions(value: PermissionMode): {
  approvalPolicy: string;
  approvalsReviewer: string;
  permissionProfile: string;
  sandbox?: string;
  sandboxPolicy?: { type: string };
} {
  if (value === "full-access") {
    return {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      permissionProfile: "full-access",
      sandbox: "danger-full-access",
      sandboxPolicy: { type: "dangerFullAccess" }
    };
  }

  return {
    approvalPolicy: "on-request",
    approvalsReviewer: value === "auto-review" ? "auto-reviewer" : "user",
    permissionProfile: "workspace-write"
  };
}

function relayWebSocketURL(
  endpoint: string,
  role: "desktop" | "client",
  deviceId: string,
  apiKey: string
): string {
  let base = endpoint.trim().replace(/\/+$/, "");
  if (base.startsWith("https://")) {
    base = `wss://${base.slice("https://".length)}`;
  } else if (base.startsWith("http://")) {
    base = `ws://${base.slice("http://".length)}`;
  }
  const separator = base.includes("?") ? "&" : "?";
  return `${base}/ws/${role}${separator}device_id=${encodeURIComponent(
    deviceId
  )}&api_key=${encodeURIComponent(apiKey)}`;
}

function parseRelayEnvelope(data: unknown): RemoteCommandEnvelope | null {
  if (typeof data !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(data) as RemoteCommandEnvelope;
    return typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function relayPublishedSourceEventId(payload: unknown): string | null {
  const event = asRecord(asRecord(payload).event);
  const sourceEventId = event.source_event_id;
  return typeof sourceEventId === "string" && sourceEventId.length > 0
    ? sourceEventId
    : null;
}

function relayPresenceFromPayload(payload: unknown): RelayPresence {
  const record = asRecord(payload);
  return {
    desktopCount: numberOrNull(record.desktop_count) ?? 0,
    clientCount: numberOrNull(record.client_count) ?? 0,
    connected: Boolean(record.connected),
    lastSeen: stringOrUndefined(record.last_seen)
  };
}

function clientCommandIdFromEnvelope(envelope: RemoteCommandEnvelope): string | null {
  const id = envelope.payload?.client_message_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function validRemoteAttachments(value: unknown): RemoteAttachmentInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is RemoteAttachmentInput => {
    const record = asRecord(item);
    if (record.kind === "image") {
      return (
        typeof record.name === "string" &&
        typeof record.mimeType === "string" &&
        record.mimeType.startsWith("image/") &&
        typeof record.dataUrl === "string" &&
        record.dataUrl.startsWith("data:image/")
      );
    }
    return (
      record.kind === "mention" &&
      typeof record.name === "string" &&
      typeof record.path === "string" &&
      record.path.length > 0
    );
  });
}

function remoteMessageFromTranscript(entry: TranscriptEntry): RemoteSnapshotMessage {
  if (entry.role === "user") {
    return {
      id: entry.id,
      role: "user",
      text: relayMessageTextFromTranscriptText(entry.text),
      createdAt: transcriptEntryCreatedAt(entry)
    };
  }
  if (entry.role === "assistant") {
    return {
      id: entry.id,
      role: "codex",
      text: relayMessageTextFromTranscriptText(entry.text),
      meta: entry.meta,
      createdAt: transcriptEntryCreatedAt(entry)
    };
  }
  return {
    id: entry.id,
    role: "event",
    text: relayTextFromTranscriptEntry(entry),
    meta: roleLabel(entry.role),
    createdAt: transcriptEntryCreatedAt(entry)
  };
}

function transcriptEntryCreatedAt(entry: TranscriptEntry): number {
  return entry.createdAt ?? timestampFromEntryId(entry.id) ?? Date.now();
}

function timestampFromEntryId(id: string): number | null {
  const match = /(?:^|-)(\d{13})(?:$|-)/.exec(id);
  if (!match) {
    return null;
  }
  const timestamp = Number.parseInt(match[1], 10);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function relayTextFromTranscriptEntry(entry: TranscriptEntry): string {
  if (entry.role === "edited") {
    return truncateRelayEventText(compactEditedTranscriptText(entry.text));
  }
  if (entry.role === "diff") {
    return truncateRelayEventText(compactDiffTranscriptText(entry.text));
  }
  return truncateRelayEventText(entry.text);
}

function relayMessageTextFromTranscriptText(text: string): string {
  return tailNotificationText(text.trim(), RELAY_MESSAGE_TEXT_MAX_CHARS);
}

function relayEventFromCodexEvent(event: CodexAdapterEvent): Record<string, unknown> {
  switch (event.type) {
    case "thread.started":
      return {
        type: event.type,
        threadId: event.threadId,
        summary: truncateRelayEventText(eventSummary(event))
      };
    case "turn.started":
    case "turn.completed":
      return {
        type: event.type,
        threadId: event.threadId,
        turnId: event.turnId,
        summary: truncateRelayEventText(eventSummary(event))
      };
    case "plan.updated":
      return {
        type: event.type,
        threadId: event.threadId,
        turnId: event.turnId,
        plan: truncateRelayEventText(planSummary(event.plan))
      };
    case "diff.updated":
      return {
        type: event.type,
        threadId: event.threadId,
        turnId: event.turnId,
        diff: truncateRelayEventText(compactDiffSummary(event.diff))
      };
    case "file.patch.updated":
      return {
        type: event.type,
        threadId: event.threadId,
        turnId: event.turnId,
        itemId: event.itemId,
        patch: truncateRelayEventText(compactEditedSummary(event.patch))
      };
    case "approval.requested":
      return {
        type: event.type,
        requestId: event.requestId,
        approvalType: event.approvalType,
        threadId: event.threadId,
        turnId: event.turnId,
        itemId: event.itemId,
        summary: truncateRelayEventText(approvalSummary(event.request))
      };
    case "raw.notification":
      return {
        type: event.type,
        method: event.method,
        summary: truncateRelayEventText(eventSummary(event))
      };
    case "raw.serverRequest":
      return {
        type: event.type,
        method: event.method,
        requestId: event.requestId,
        summary: truncateRelayEventText(eventSummary(event))
      };
    case "message.delta":
    case "reasoning.delta":
      return {
        type: event.type,
        threadId: event.threadId,
        turnId: event.turnId,
        itemId: event.itemId,
        text: truncateRelayEventText(event.text)
      };
    case "command.delta":
      return {
        type: event.type,
        threadId: event.threadId,
        turnId: event.turnId,
        itemId: event.itemId,
        stream: event.stream,
        text: truncateRelayEventText(event.text)
      };
  }
}

function buildTurnInput(text: string, attachments: ComposerAttachment[]): UserInput[] {
  const inputText =
    text.length > 0
      ? text
      : attachments.some(attachment => attachment.type === "localImage")
        ? `Please inspect the attached image${attachments.length === 1 ? "" : "s"}.`
        : "Please inspect the attached file.";
  const input: UserInput[] = [
    {
      type: "text",
      text: inputText,
      text_elements: []
    }
  ];

  for (const attachment of attachments) {
    if (attachment.type === "localImage") {
      input.push({
        type: "localImage",
        path: attachment.path
      });
    } else {
      input.push({
        type: "mention",
        name: attachment.name,
        path: attachment.path
      });
    }
  }

  return input;
}

function shouldHandleAttachmentPaste(data: DataTransfer): boolean {
  const files = Array.from(data.files);
  if (files.length > 0) {
    return true;
  }

  const types = Array.from(data.types);
  if (
    types.some(type =>
      type.startsWith("image/") ||
      ["Files", "text/uri-list", "x-special/gnome-copied-files"].includes(type)
    )
  ) {
    return true;
  }

  return data
    .getData("text/plain")
    .split(/\r?\n/)
    .some(line => {
      const trimmed = line.trim();
      return trimmed.startsWith("file://") || trimmed.startsWith("/");
    });
}

function activeComposerTrigger(
  value: string,
  cursor: number
): { mode: ComposerCompletionMode; query: string; tokenStart: number } | null {
  const prefix = value.slice(0, cursor);
  const match = /(^|\s)([@$])([^\s@$]*)$/.exec(prefix);
  if (!match) {
    return null;
  }

  const tokenStart = match.index + match[1].length;
  return {
    mode: match[2] === "@" ? "file" : "skill",
    query: match[3],
    tokenStart
  };
}

function hasNormalTextPaste(data: DataTransfer): boolean {
  const text = data.getData("text/plain").trim();
  if (text.length === 0) {
    return false;
  }

  return !text
    .split(/\r?\n/)
    .some(line => {
      const trimmed = line.trim();
      return trimmed.startsWith("file://") || trimmed.startsWith("/");
    });
}

function normalizeClipboardAttachmentResult(
  value: ClipboardAttachmentResult | ComposerAttachment[]
): ComposerAttachment[] {
  return Array.isArray(value) ? value : value.attachments;
}

function userTranscriptText(text: string, attachments: ComposerAttachment[]): string {
  const body = text.length > 0 ? text : "Sent attachment";
  if (attachments.length === 0) {
    return body;
  }

  const attachmentLines = attachments.map(attachment => {
    const label = attachment.type === "localImage" ? "image" : "file";
    return `- ${label}: ${attachment.name}`;
  });

  return `${body}\n\nAttachments:\n${attachmentLines.join("\n")}`;
}

function ComposerCompletionMenu({
  completion,
  language,
  onSelect
}: {
  completion: ComposerCompletionState;
  language: UILanguage;
  onSelect: (item: ComposerSuggestion) => void;
}) {
  const t = (key: UIMessageKey, values?: Record<string, string | number>) =>
    textFor(language, key, values);
  const emptyText =
    completion.mode === "file" ? t("noMatchingFiles") : t("noMatchingSkills");
  return (
    <div className="completionMenu" role="listbox" aria-label={t("messageCodex")}>
      {completion.loading && completion.items.length === 0 ? (
        <div className="completionEmpty">{t("searching")}</div>
      ) : completion.items.length === 0 ? (
        <div className="completionEmpty">{emptyText}</div>
      ) : (
        completion.items.map((item, index) => (
          <button
            aria-selected={index === completion.selectedIndex}
            className="completionItem"
            key={item.id}
            onMouseDown={event => {
              event.preventDefault();
              onSelect(item);
            }}
            role="option"
            type="button"
          >
            <span className="completionLabel">
              {completion.mode === "skill" ? item.label : item.label}
            </span>
            <span className="completionDetail">
              {completion.mode === "skill" ? "[Skill] " : ""}
              {item.detail}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

const TimelineEntry = memo(function TimelineEntry({
  entry,
  language
}: {
  entry: TranscriptEntry;
  language: UILanguage;
}) {
  return (
    <article className="timelineItem" data-role={entry.role}>
      <span className="timelineMarker" aria-hidden="true" />
      <div className="timelineContent">
        <div className="timelineMeta">
          <strong>{roleLabel(entry.role, language)}</strong>
          {entry.meta ? <code>{entry.meta}</code> : null}
        </div>
        <MarkdownContent text={entry.text || "..."} />
      </div>
    </article>
  );
});

const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="markdownContent">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

const markdownComponents: Components = {
  code(props) {
    const { children, className, ...rest } = props;
    const text = String(children ?? "");
    const language = className ?? "";

    if (language.includes("language-diff")) {
      return (
        <code className={className} {...rest}>
          {renderDiffLines(text)}
        </code>
      );
    }

    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
};

function renderDiffLines(text: string): ReactNode[] {
  return text.replace(/\n$/, "").split("\n").map((line, index) => {
    const kind = diffLineKind(line);
    return (
      <span className="diffLine" data-kind={kind} key={`${index}-${kind}`}>
        {line || " "}
        {"\n"}
      </span>
    );
  });
}

function diffLineKind(line: string): "add" | "remove" | "hunk" | "meta" | "context" {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "add";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "remove";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "meta";
  }
  return "context";
}

function InlineActionBar(props: {
  approvals: ApprovalEntry[];
  language: UILanguage;
  onResolveApproval: (
    approval: ApprovalEntry,
    decision: "accept" | "decline" | "cancel"
  ) => Promise<void>;
}) {
  if (props.approvals.length === 0) {
    return null;
  }
  const t = (key: UIMessageKey, values?: Record<string, string | number>) =>
    textFor(props.language, key, values);

  return (
    <div className="inlineActionBar">
      {props.approvals.map(approval => (
        <div className="inlineApproval" key={String(approval.id)}>
          <div className="inlineApprovalText">
            <strong>{approval.type}</strong>
            <span>{approvalSummary(approval.request)}</span>
          </div>
          <div className="inlineApprovalActions">
            <button
              className="approveButton"
              type="button"
              onClick={() => void props.onResolveApproval(approval, "accept")}
            >
              <Check size={14} />
              <span>{t("accept")}</span>
            </button>
            <button
              className="declineButton"
              type="button"
              onClick={() => void props.onResolveApproval(approval, "decline")}
            >
              <X size={14} />
              <span>{t("decline")}</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function appendAssistantDelta(
  transcript: TranscriptEntry[],
  delta: string
): TranscriptEntry[] {
  const next = [...transcript];
  const last = next.at(-1);

  if (last?.role === "assistant") {
    next[next.length - 1] = { ...last, text: last.text + delta };
    return next;
  }

  next.push({
    id: `assistant-${Date.now()}`,
    role: "assistant",
    text: delta,
    createdAt: Date.now()
  });
  return next;
}

function relayNotificationBodyFromFinalMessage(message: string): string {
  return cleanNotificationText(message);
}

function cleanNotificationText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateNotificationText(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, maxChars).join("").trimEnd()}...`;
}

function tailNotificationText(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `...${chars.slice(chars.length - maxChars).join("").trimStart()}`;
}

function truncateRelayEventText(text: string): string {
  return truncateNotificationText(text.trim(), RELAY_EVENT_TEXT_MAX_CHARS);
}

function compactEditedTranscriptText(text: string): string {
  return text
    .replace(/\n*```diff[\s\S]*?```\n*/g, "\n")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .join("\n");
}

function compactDiffTranscriptText(text: string): string {
  const stats = diffStats(text);
  return stats === "+0 -0" ? text : `Diff updated (${stats})`;
}

function transcriptFromThread(thread: Thread): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];

  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      const record = asRecord(item);
      const id = String(record.id ?? `${turn.id}-${entries.length}`);
      const type = typeof record.type === "string" ? record.type : "";

      entries.push(...timelineEntriesFromItem(id, type, record));
    }
  }

  return entries;
}

function timelineEntriesFromItem(
  id: string,
  type: string,
  record: Record<string, unknown>
): TranscriptEntry[] {
  const normalizedType = type.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  const entries: TranscriptEntry[] = [];

  if (type === "userMessage" || (normalizedType === "message" && record.role === "user")) {
    const text = firstText(contentText(record.content), itemText(record));
    if (text) {
      entries.push({ id, role: "user", text });
    }
    entries.push(...localImageEntries(id, record.content));
    return entries;
  }

  if (
    type === "agentMessage" ||
    (normalizedType === "message" && record.role === "assistant")
  ) {
    const text = firstText(itemText(record), contentText(record.content));
    if (text) {
      entries.push({ id, role: "assistant", text, meta: stringOrUndefined(record.phase) });
    }
    return entries;
  }

  if (isToolCallType(type, normalizedType)) {
    entries.push({
      id,
      role: toolRole(record),
      text: toolCallText(record),
      meta: stringOrUndefined(record.name) ?? "tool"
    });
    return entries;
  }

  if (isToolOutputType(type, normalizedType)) {
    const text = outputText(record);
    if (text) {
      entries.push({
        id,
        role: "commandOutput",
        text,
        meta: stringOrUndefined(record.call_id)
      });
    }
    return entries;
  }

  if (normalizedType === "web_search_call") {
    entries.push({
      id,
      role: "search",
      text: "Web search requested",
      meta: stringOrUndefined(record.status)
    });
    return entries;
  }

  if (normalizedType.includes("reasoning")) {
    const text = itemText(record);
    if (text) {
      entries.push({ id, role: "system", text, meta: "reasoning" });
    }
    return entries;
  }

  if (isEditedType(type, normalizedType, record)) {
    entries.push({
      id,
      role: "edited",
      text: editedSummary(record),
      meta: stringOrUndefined(record.status) ?? stringOrUndefined(record.name)
    });
    return entries;
  }

  if (isCommandType(type, normalizedType, record)) {
    entries.push({
      id,
      role: "command",
      text: commandItemText(record) || itemSummary(type, record),
      meta: stringOrUndefined(record.status)
    });
  }

  return entries;
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map(item => {
      const record = asRecord(item);
      return firstText(record.text, record.input_text, record.output_text);
    })
    .filter(Boolean)
    .join("\n");
}

function localImageEntries(id: string, value: unknown): TranscriptEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: TranscriptEntry[] = [];

  value.forEach((item, index) => {
    const record = asRecord(item);
    const type = stringOrUndefined(record.type);
    const path = firstText(record.path, record.url);
    if ((type === "localImage" || type === "image") && path) {
      entries.push({
        id: `${id}-image-${index}`,
        role: "viewedImage",
        text: path,
        meta: type
      });
    }
  });

  return entries;
}

function systemEntry(text: string): TranscriptEntry {
  return {
    id: `system-${Date.now()}`,
    role: "system",
    text
  };
}

function roleLabel(role: TranscriptEntry["role"], language: UILanguage = "en"): string {
  switch (role) {
    case "assistant":
      return textFor(language, "roleCodex");
    case "user":
      return textFor(language, "roleYou");
    case "system":
      return textFor(language, "roleSystem");
    case "turn":
      return textFor(language, "roleTurn");
    case "command":
      return textFor(language, "roleRan");
    case "commandOutput":
      return textFor(language, "roleOutput");
    case "tool":
      return textFor(language, "roleTool");
    case "edited":
      return textFor(language, "roleEdited");
    case "viewedImage":
      return textFor(language, "roleViewedImage");
    case "interaction":
      return textFor(language, "roleInteracted");
    case "search":
      return textFor(language, "roleSearch");
    case "plan":
      return textFor(language, "rolePlan");
    case "diff":
      return textFor(language, "roleDiff");
    case "approval":
      return textFor(language, "roleApproval");
  }
}

function appendCommandTimelineDelta(
  entries: TranscriptEntry[],
  id: string,
  stream: "stdout" | "stderr" | "unknown",
  text: string
): TranscriptEntry[] {
  const entryId = `command-${id}`;
  const existing = entries.find(entry => entry.id === entryId);
  if (!existing) {
    return [
      ...entries,
      {
        id: entryId,
        role: "commandOutput",
        text,
        meta: stream
      }
    ];
  }

  return entries.map(entry =>
    entry.id === entryId ? { ...entry, text: entry.text + text } : entry
  );
}

function upsertTimelineEvent(
  entries: TranscriptEntry[],
  entry: TranscriptEntry
): TranscriptEntry[] {
  if (!entries.some(item => item.id === entry.id)) {
    return [...entries, entry];
  }

  return entries.map(item => (item.id === entry.id ? entry : item));
}

function timelineEntryFromRawNotification(
  event: Extract<CodexAdapterEvent, { type: "raw.notification" }>
): TranscriptEntry | null {
  const method = event.method;
  if (
    method.includes("tokenUsage") ||
    method.includes("agentMessage") ||
    method.includes("thread/") ||
    method.includes("turn/")
  ) {
    return null;
  }

  const params = asRecord(event.raw.params);
  const item = asRecord(params.item);
  const itemType = stringOrUndefined(item.type) ?? stringOrUndefined(params.type);
  const itemId = stringOrUndefined(item.id) ?? stringOrUndefined(params.itemId) ?? method;

  if (method === "item/started" && itemType) {
    if (
      itemType === "agentMessage" ||
      itemType === "userMessage" ||
      itemType === "message" ||
      itemType.includes("reasoning")
    ) {
      return null;
    }
    const entries = timelineEntriesFromItem(itemId, itemType, item);
    if (entries.length > 0) {
      return entries[0];
    }
    return {
      id: `raw-${itemId}`,
      role: isEditedType(itemType, itemType, item)
        ? "edited"
        : isCommandType(itemType, itemType, item)
          ? "command"
          : itemType.includes("web")
            ? "search"
            : "tool",
      text: itemSummary(itemType, item),
      meta: itemType
    };
  }

  if (method.includes("web_search")) {
    return {
      id: `raw-${method}-${itemId}`,
      role: "search",
      text: eventSummary(event),
      meta: method
    };
  }

  if (method.includes("fileChange") || method.includes("patch")) {
    const value = params.patch ?? params.fileChange ?? params.change ?? item ?? params;
    return {
      id: `raw-${method}-${itemId}`,
      role: "edited",
      text: editedSummary(value),
      meta: method
    };
  }

  return null;
}

function threadIdFromRawNotification(
  event: Extract<CodexAdapterEvent, { type: "raw.notification" }>
): string | null {
  const params = asRecord(event.raw.params);
  const item = asRecord(params.item);
  const thread = asRecord(params.thread);
  return (
    stringOrUndefined(params.threadId) ??
    stringOrUndefined(item.threadId) ??
    stringOrUndefined(thread.id) ??
    stringOrUndefined(thread.threadId) ??
    null
  );
}

function isHighFrequencyRelayEvent(event: CodexAdapterEvent): boolean {
  return (
    event.type === "message.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "command.delta"
  );
}

function eventSummary(event: CodexAdapterEvent): string {
  switch (event.type) {
    case "message.delta":
    case "reasoning.delta":
      return event.text;
    case "command.delta":
      return `${event.stream}: ${event.text}`;
    case "thread.started":
      return event.threadId;
    case "turn.started":
    case "turn.completed":
      return event.turnId;
    case "approval.requested":
      return event.approvalType;
    case "raw.notification":
      return event.method;
    case "raw.serverRequest":
      return event.method;
    default:
      return JSON.stringify(event).slice(0, 160);
  }
}

function approvalSummary(value: unknown): string {
  const request = asRecord(value);
  const command = request.command;
  const reason = request.reason;
  const grantRoot = request.grantRoot;

  if (typeof command === "string" && command.length > 0) {
    return command;
  }
  if (typeof reason === "string" && reason.length > 0) {
    return reason;
  }
  if (typeof grantRoot === "string" && grantRoot.length > 0) {
    return `Allow writes under ${grantRoot}`;
  }
  return "Codex is requesting a decision.";
}

function planSummary(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((step, index) => {
        const item = asRecord(step);
        return `${index + 1}. ${String(item.step ?? item.text ?? JSON.stringify(step))}`;
      })
      .join("\n");
  }

  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function diffSummary(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 0 ? value : "Diff updated";
  }

  const record = asRecord(value);
  const files = record.files;
  if (Array.isArray(files) && files.length > 0) {
    return `Changed ${files.length} file${files.length === 1 ? "" : "s"}.`;
  }

  return "Diff updated";
}

function compactDiffSummary(value: unknown): string {
  if (typeof value === "string") {
    const stats = diffStats(value);
    return stats === "+0 -0" ? "Diff updated" : `Diff updated (${stats})`;
  }

  const record = asRecord(value);
  const changes = fileChanges(record);
  if (changes.length > 0) {
    return changes.map(formatCompactFileChange).join("\n");
  }

  const files = record.files;
  if (Array.isArray(files) && files.length > 0) {
    const fileSummaries = files
      .map(file => formatCompactFileChange(asRecord(file)))
      .filter(summary => summary !== "Edited file");
    if (fileSummaries.length > 0) {
      return fileSummaries.join("\n");
    }
    return `Changed ${files.length} file${files.length === 1 ? "" : "s"}.`;
  }

  return "Diff updated";
}

function editedSummary(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 0 ? value : "Edited files";
  }

  const record = asRecord(value);
  const changes = fileChanges(record);
  if (changes.length > 0) {
    return changes.map(formatFileChange).join("\n\n");
  }

  const files = record.files ?? record.updatedFiles ?? record.changedFiles;
  if (Array.isArray(files) && files.length > 0) {
    return files
      .map((file, index) => {
        const path = typeof file === "string" ? file : firstText(asRecord(file).path);
        return path || `File ${index + 1}`;
      })
      .join("\n");
  }

  const path = firstText(record.path, record.file, record.filePath);
  if (path) {
    return `Edited ${path}`;
  }

  const output = outputText(record);
  if (output) {
    return output;
  }

  return "Edited files";
}

function compactEditedSummary(value: unknown): string {
  if (typeof value === "string") {
    const stats = diffStats(value);
    return stats === "+0 -0" ? "Edited files" : `Edited files (${stats})`;
  }

  const record = asRecord(value);
  const changes = fileChanges(record);
  if (changes.length > 0) {
    return changes.map(formatCompactFileChange).join("\n");
  }

  const files = record.files ?? record.updatedFiles ?? record.changedFiles;
  if (Array.isArray(files) && files.length > 0) {
    return files
      .map((file, index) => {
        if (typeof file === "string") {
          return file || `File ${index + 1}`;
        }
        return formatCompactFileChange(asRecord(file));
      })
      .join("\n");
  }

  const path = firstText(record.path, record.file, record.filePath);
  if (path) {
    const diff = firstText(record.diff, record.patch);
    const stats = diff ? diffStats(diff) : "";
    return `Edited ${path}${stats ? ` (${stats})` : ""}`;
  }

  return "Edited files";
}

function fileChanges(record: Record<string, unknown>): Record<string, unknown>[] {
  const directChanges = record.changes;
  if (Array.isArray(directChanges)) {
    return directChanges
      .map(change => asRecord(change))
      .filter(change => Object.keys(change).length > 0);
  }

  const nestedPatch = asRecord(record.patch);
  const nestedChanges = nestedPatch.changes;
  if (Array.isArray(nestedChanges)) {
    return nestedChanges
      .map(change => asRecord(change))
      .filter(change => Object.keys(change).length > 0);
  }

  const nestedChange = asRecord(record.change);
  if (Object.keys(nestedChange).length > 0) {
    return [nestedChange];
  }

  return [];
}

function formatFileChange(change: Record<string, unknown>): string {
  const path = firstText(change.path, change.file, change.filePath);
  const diff = firstText(change.diff, change.patch);
  const stats = diff ? diffStats(diff) : "";
  const title = `${path || "Edited file"}${stats ? ` (${stats})` : ""}`;

  if (!diff) {
    return title;
  }

  return `${title}\n\n\`\`\`diff\n${diff.trimEnd()}\n\`\`\``;
}

function formatCompactFileChange(change: Record<string, unknown>): string {
  const path = firstText(change.path, change.file, change.filePath);
  const diff = firstText(change.diff, change.patch);
  const stats = diff ? diffStats(diff) : "";
  return `${path || "Edited file"}${stats ? ` (${stats})` : ""}`;
}

function diffStats(diff: string): string {
  let added = 0;
  let removed = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }

  return `+${added} -${removed}`;
}

function commandItemText(record: Record<string, unknown>): string {
  const command = commandValue(record.command);
  const cmd = record.cmd;
  const commandLine = record.commandLine;
  const output = record.output;
  const stdout = record.stdout;
  const stderr = record.stderr;
  const parsedArgs = parseJsonRecord(firstText(record.arguments));
  const parsedCommand = commandValue(parsedArgs.command);

  return [
    command,
    cmd,
    commandLine,
    parsedCommand,
    parsedArgs.cmd,
    parsedArgs.commandLine,
    output,
    stdout,
    stderr
  ]
    .map(value => (typeof value === "string" ? value : ""))
    .filter(Boolean)
    .join("\n");
}

function itemText(record: Record<string, unknown>): string {
  const text = record.text;
  const summary = record.summary;
  const message = record.message;
  const content = contentText(record.content);

  return [text, summary, message, content]
    .map(value => (typeof value === "string" ? value : ""))
    .filter(Boolean)
    .join("\n");
}

function toolRole(record: Record<string, unknown>): TranscriptEntry["role"] {
  const name = stringOrUndefined(record.name);
  if (name === "exec_command") {
    return "command";
  }
  if (name === "apply_patch") {
    return "edited";
  }
  if (name === "view_image") {
    return "viewedImage";
  }
  if (name === "write_stdin") {
    return "interaction";
  }
  return "tool";
}

function toolCallText(record: Record<string, unknown>): string {
  const name = stringOrUndefined(record.name) ?? "tool";
  const args = stringOrUndefined(record.arguments);
  if (!args) {
    return name;
  }

  const parsed = parseJsonRecord(args);
  if (name === "apply_patch") {
    return Object.keys(parsed).length > 0
      ? editedSummary(parsed)
      : `\`\`\`diff\n${args.trimEnd()}\n\`\`\``;
  }

  if (name === "view_image") {
    return firstText(parsed.path, parsed.image, parsed.url, args);
  }

  if (name === "write_stdin") {
    const session = firstText(parsed.session_id, parsed.sessionId);
    const chars = firstText(parsed.chars);
    return [
      "Interacted with background terminal",
      session ? `Session ${session}` : "",
      chars ? `Input: ${chars}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  const cmd = stringOrUndefined(parsed.cmd);
  if (cmd) {
    return cmd;
  }

  return `${name}\n${args}`;
}

function outputText(record: Record<string, unknown>): string {
  const output = record.output;
  if (typeof output === "string") {
    const parsed = parseJsonRecord(output);
    return firstText(parsed.output, output);
  }
  return "";
}

function itemSummary(type: string, record: Record<string, unknown>): string {
  if (isCommandType(type, type, record)) {
    return commandItemText(record) || "Command started";
  }
  if (isEditedType(type, type, record)) {
    return editedSummary(record);
  }
  const name = stringOrUndefined(record.name);
  const text = itemText(record);
  if (text) {
    return text;
  }
  return name ? `${type}: ${name}` : type;
}

function isToolCallType(type: string, normalizedType: string): boolean {
  return (
    normalizedType === "function_call" ||
    type === "custom_tool_call" ||
    normalizedType === "custom_tool_call"
  );
}

function isToolOutputType(type: string, normalizedType: string): boolean {
  return (
    normalizedType === "function_call_output" ||
    type === "custom_tool_call_output" ||
    normalizedType === "custom_tool_call_output"
  );
}

function isCommandType(
  type: string,
  normalizedType: string,
  record: Record<string, unknown>
): boolean {
  const name = stringOrUndefined(record.name);
  return (
    name === "exec_command" ||
    normalizedType.includes("command") ||
    type.includes("command") ||
    type.includes("exec") ||
    Boolean(record.command) ||
    Boolean(record.cmd) ||
    Boolean(record.commandLine)
  );
}

function isEditedType(
  type: string,
  normalizedType: string,
  record: Record<string, unknown>
): boolean {
  const name = stringOrUndefined(record.name);
  return (
    name === "apply_patch" ||
    normalizedType.includes("file_change") ||
    normalizedType.includes("patch") ||
    type.includes("fileChange") ||
    type.includes("applyPatch") ||
    type.includes("patch")
  );
}

function commandValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => String(item)).join(" ");
  }
  return typeof value === "string" ? value : "";
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "";
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function upsertSession(sessions: SessionView[], session: SessionView): SessionView[] {
  return [
    session,
    ...sessions.filter(item => item.threadId !== session.threadId)
  ].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function sessionMeta(session: SessionView): string {
  const prefix = session.threadId.slice(0, 8);
  if (!session.updatedAt) {
    return prefix;
  }
  const date = new Date(session.updatedAt * 1000);
  return `${prefix} · ${date.toLocaleString()}`;
}

function workspaceName(workspace: string): string {
  const normalized = workspace.replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) || workspace;
}

function readSavedWorkspaces(): string[] {
  try {
    const raw = window.localStorage.getItem(WORKSPACES_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) {
      return parsed.filter(item => typeof item === "string" && item.length > 0);
    }
  } catch {
    // Ignore malformed localStorage.
  }

  const lastWorkspace = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  return lastWorkspace ? [lastWorkspace] : [];
}

function saveWorkspaces(workspaces: string[]): void {
  window.localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces));
}

function readCachedWorkspaceSessions(
  workspaces: string[],
  hiddenSessionIds: Set<string>
): WorkspaceSessionMap {
  try {
    const raw = window.localStorage.getItem(SESSION_LIST_CACHE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const record = asRecord(parsed);
    const cache: WorkspaceSessionMap = {};
    for (const cwd of workspaces) {
      const sessions = record[cwd];
      if (!Array.isArray(sessions)) {
        continue;
      }
      const normalized = sessions
        .map(item => sessionViewFromCachedValue(item))
        .filter((item): item is SessionView => Boolean(item))
        .filter(item => !hiddenSessionIds.has(item.threadId));
      if (normalized.length > 0) {
        cache[cwd] = normalized;
      }
    }
    return cache;
  } catch {
    return {};
  }
}

function writeCachedWorkspaceSessions(sessionsByWorkspace: WorkspaceSessionMap): void {
  window.localStorage.setItem(
    SESSION_LIST_CACHE_STORAGE_KEY,
    JSON.stringify(sessionsByWorkspace)
  );
}

function sessionViewFromCachedValue(value: unknown): SessionView | null {
  const record = asRecord(value);
  const threadId = stringOrUndefined(record.threadId);
  const title = stringOrUndefined(record.title);
  if (!threadId || !title) {
    return null;
  }
  return {
    threadId,
    title,
    updatedAt: numberOrNull(record.updatedAt) ?? undefined,
    status: stringOrUndefined(record.status)
  };
}

function readStringList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) {
      return parsed.filter(item => typeof item === "string" && item.length > 0);
    }
  } catch {
    // Ignore malformed localStorage.
  }
  return [];
}

function saveStringList(key: string, values: string[]): void {
  window.localStorage.setItem(key, JSON.stringify(values));
}

function rememberClientCommandId(previous: Set<string>, id: string): Set<string> {
  const nextValues = [...previous, id].slice(-200);
  saveStringList(CLIENT_COMMAND_IDS_STORAGE_KEY, nextValues);
  return new Set(nextValues);
}

function readStringMap(key: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] =>
            typeof entry[0] === "string" &&
            typeof entry[1] === "string" &&
            entry[1].length > 0
        )
      );
    }
  } catch {
    // Ignore malformed localStorage.
  }
  return {};
}

function saveStringMap(key: string, values: Record<string, string>): void {
  window.localStorage.setItem(key, JSON.stringify(values));
}

function upsertWorkspace(workspaces: string[], workspace: string): string[] {
  return [
    workspace,
    ...workspaces.filter(item => item !== workspace)
  ];
}

function readSavedSession(workspace: string): SessionView | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const sessions = JSON.parse(raw) as Record<string, SessionView | undefined>;
    return sessions[workspace] ?? null;
  } catch {
    return null;
  }
}

function saveSession(workspace: string, session: SessionView): void {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    const sessions = raw ? (JSON.parse(raw) as Record<string, SessionView>) : {};
    sessions[workspace] = session;
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage persistence is a convenience, not a hard dependency.
  }
}

function removeSavedSession(workspace: string, threadId: string): void {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    const sessions = raw ? (JSON.parse(raw) as Record<string, SessionView>) : {};
    if (sessions[workspace]?.threadId !== threadId) {
      return;
    }
    delete sessions[workspace];
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage persistence is a convenience, not a hard dependency.
  }
}
