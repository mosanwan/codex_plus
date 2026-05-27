import {
  ArrowUp,
  Atom,
  AtSign,
  Bell,
  BookOpen,
  Bot,
  Box,
  Brush,
  Bug,
  ChevronRight,
  Check,
  CircleDot,
  Code2,
  Compass,
  Copy,
  Cpu,
  Cloud,
  Database,
  Eye,
  FileText,
  Flag,
  Flame,
  FlaskConical,
  FolderOpen,
  Gem,
  GitBranch,
  Globe,
  Grid3X3,
  KeyRound,
  Laptop,
  Layers,
  ListChecks,
  Lock,
  MessageCircle,
  Package,
  Palette,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Square,
  Star,
  SquareTerminal,
  Clock,
  Satellite,
  Target,
  TestTube2,
  Wrench,
  Workflow,
  Waves,
  Zap,
  Wifi,
  X
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode, RefObject } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  mockSnapshot,
  type Approval,
  type ConnectionState,
  type ModelEffort,
  type MessageAttachment,
  type Message,
  type PermissionMode,
  type Session,
  type ViewMode,
  type Workspace
} from "./remote";

const RELAY_ENDPOINT_STORAGE_KEY = "codep.relayEndpoint";
const RELAY_API_KEY_STORAGE_KEY = "codep.relayApiKey";
const RELAY_DEVICE_ID_STORAGE_KEY = "codep.relayDeviceId";
const RELAY_DESKTOP_DEVICE_ID_STORAGE_KEY = "codep.relayDesktopDeviceId";
const RELAY_LAST_EVENT_ID_STORAGE_KEY = "codep.relayLastEventId";
const CLOUD_RELAY_ENDPOINT = "wss://codex-bridge.three.ink";
const SYSTEM_NOTIFICATIONS_ENABLED_STORAGE_KEY = "codep.systemNotificationsEnabled";
const NOTIFICATION_VIBRATION_ENABLED_STORAGE_KEY = "codep.notificationVibrationEnabled";
const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY = "codep.notificationSoundEnabled";
const NOTIFICATION_SOUND_FILE = "codep_notify.wav";
const NOTIFICATION_CHANNEL_PREFIX = "codep_turn_complete";
const NOTIFICATION_CHANNEL_VERSION = "v3";
const NOTIFICATION_BODY_MAX_CHARS = 100;
const PENDING_RELAY_COMMANDS_STORAGE_KEY = "codep.pendingRelayCommands";
const RELIABLE_RELAY_RETRY_MS = 5000;
const PENDING_RELAY_COMMAND_MAX_AGE_MS = 120000;
const RELAY_RECONNECT_BASE_MS = 1000;
const RELAY_RECONNECT_MAX_MS = 30000;
const FAVORITE_SESSIONS_STORAGE_KEY = "codep.mobileFavoriteSessions";
const COLLAPSED_WORKSPACES_STORAGE_KEY = "codep.mobileCollapsedWorkspaces";
const THEME_STORAGE_KEY = "codep.theme";
const LANGUAGE_STORAGE_KEY = "codep.language";
const INITIAL_VISIBLE_MESSAGE_COUNT = 40;
const MESSAGE_PAGE_SIZE = 40;
const PERMISSION_OPTIONS: Array<{
  value: PermissionMode;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "Default",
    description:
      "Read and edit this workspace, run commands, and ask before internet access or edits outside the workspace."
  },
  {
    value: "auto-review",
    label: "Auto-review",
    description:
      "Same as Default, but eligible approvals are routed through the auto-reviewer subagent."
  },
  {
    value: "full-access",
    label: "Full Access",
    description:
      "Edit outside this workspace and access the internet without asking for approval."
  }
];
const MODEL_OPTIONS = ["gpt-5.5", "gpt-5", "gpt-5-codex", "o3"] as const;
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

type RelayConnectionState =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";
type SessionTab = "all" | "recent" | "favorites";
type ThemeMode = "dark" | "light";
type UILanguage = "en" | "zh-CN";
type ComposerCompletionMode = "file" | "skill";

interface ModelOption {
  id: string;
  label: string;
}

interface RateLimitUsage {
  primary: { leftPercent: number | null } | null;
  secondary: { leftPercent: number | null } | null;
}

const LANGUAGE_OPTIONS: Array<{ value: UILanguage; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" }
];

const UI_TEXT = {
  en: {
    sessions: "Sessions",
    chat: "Chat",
    settings: "Settings",
    noSession: "No session",
    ready: "Ready",
    working: "Working",
    workingOnDesktop: "Working on desktop",
    sessionBrowser: "Session browser",
    sessionsSubtitle: "Workspaces and desktop sessions",
    sessionViews: "Session views",
    all: "All",
    recent: "Recent",
    favorites: "Favorites",
    noWorkspaces: "Connect a desktop app to load workspaces.",
    noWorkspaceSessions: "No sessions in this workspace.",
    recentEmpty: "Recent sessions appear here after workspace history loads.",
    favoriteEmpty: "Star sessions to keep them in this view.",
    addWorkspace: "Open workspace",
    workspacePath: "Desktop workspace path",
    workspacePathPlaceholder: "/home/three/workspace/project",
    openWorkspaceTitle: "Open workspace",
    openWorkspaceHelp: "Enter a path that exists on the connected desktop.",
    closeWorkspaceDialog: "Close workspace dialog",
    expandWorkspace: "Expand {name}",
    collapseWorkspace: "Collapse {name}",
    openWorkspace: "Open workspace {name}",
    newSessionIn: "New session in {name}",
    changeIconFor: "Change icon for {name}",
    iconPicker: "Choose session icon",
    closeIconPicker: "Close icon picker",
    unreadTurn: "Unread turn",
    favoriteSession: "Favorite {name}",
    unfavoriteSession: "Unfavorite {name}",
    renameSession: "Rename {name}",
    sessionName: "Session name",
    saveSessionName: "Save session name",
    cancelRename: "Cancel rename",
    chatMessages: "Chat messages",
    loadOlderMessages: "Load {count} older messages",
    hiddenMessages: "{count} hidden",
    loading: "loading",
    resumingSession: "Resuming this desktop session...",
    pendingApprovals: "Pending approvals",
    desktopRunningTurn: "Desktop Codex is running this turn.",
    imageAttachments: "Image attachments",
    addImages: "Add images",
    selectedImages: "Selected images",
    removeAttachment: "Remove {name}",
    fileMention: "File mention",
    files: "Files",
    skills: "Skills",
    searchFiles: "Search files",
    searchSkills: "Search skills",
    noMatchingFiles: "No matching files",
    noMatchingSkills: "No matching skills",
    messageCodex: "Message Codex",
    composerPlaceholder: "Message Codex on your desktop",
    runtimeSettings: "Runtime settings",
    runtimeSettingsTitle: "Runtime settings",
    closeRuntimeSettings: "Close runtime settings",
    stopCurrentTurn: "Stop current turn",
    sendMessage: "Send message",
    sentImages: "Sent images",
    sentAttachments: "Sent attachments",
    mobileSubtitle: "Browser-first remote control shell",
    settingsSubtitle: "Remote access and app preferences",
    connection: "Connection",
    relayEndpoint: "Relay endpoint",
    desktopDeviceId: "Desktop device",
    desktopDeviceIdFallback: "Selected device ID",
    loadingDesktopDevices: "Loading desktop devices...",
    noDesktopDevices: "No online desktop devices for this API key.",
    refreshDevices: "Refresh",
    desktopConnection: "Desktop connection",
    desktopOnline: "Desktop online",
    desktopOffline: "Desktop not connected",
    apiKey: "API key",
    relayHelp:
      "Use the same API key as the desktop app. The endpoint should point to the Go relay server. Online desktop devices are listed automatically.",
    relayMode: "Relay mode",
    missingKey: "Missing key",
    desktop: "Desktop",
    mobileClients: "mobile",
    device: "Device",
    appearance: "Appearance",
    theme: "Theme",
    dark: "Dark",
    light: "Light",
    language: "Language",
    appearanceHelp: "Applies to all mobile app surfaces.",
    model: "Model",
    reasoningLevel: "Reasoning level",
    activeModel: "Active model",
    safety: "Safety",
    usageLimits: "Usage limits",
    defaultPermissions: "Default /permissions",
    permissions: "Permissions",
    workspaceBoundary: "Workspace boundary",
    enforced: "Enforced",
    notifications: "Notifications",
    systemNotifications: "System notifications",
    notificationVibration: "Vibration",
    notificationSound: "Sound",
    notificationsHelp:
      "When a Codex turn completes, Android can show a system notification with a short session summary while the app is running in the background.",
    notConfigured: "Not configured",
    developer: "Developer",
    androidShell: "Android shell",
    dataSource: "Data source",
    relaySnapshot: "Relay snapshot",
    primary: "Primary",
    approve: "Approve",
    decline: "Decline",
    risk: "{risk} risk",
    copied: "Copied",
    copy: "Copy",
    copyApiKey: "Copy API key",
    copyDesktopDeviceId: "Copy desktop device ID",
    copyDeviceId: "Copy mobile device ID",
    contextUnknown: "Unknown",
    contextUsed: "{count} used",
    contextLeft: "{count} left",
    customApprovalPolicy: "Custom approval policy.",
    notReported: "not reported",
    online: "Online",
    pairing: "Pairing",
    offline: "Offline",
    disconnected: "Disconnected",
    connecting: "Connecting",
    connected: "Connected",
    reconnecting: "Reconnecting",
    error: "Error",
    disabled: "Disabled",
    approval: "Approval"
  },
  "zh-CN": {
    sessions: "会话",
    chat: "聊天",
    settings: "设置",
    noSession: "没有会话",
    ready: "就绪",
    working: "运行中",
    workingOnDesktop: "桌面端运行中",
    sessionBrowser: "会话浏览",
    sessionsSubtitle: "工作区与桌面端会话",
    sessionViews: "会话视图",
    all: "全部",
    recent: "最近",
    favorites: "收藏",
    noWorkspaces: "连接桌面端后会加载工作区。",
    noWorkspaceSessions: "这个工作区还没有会话。",
    recentEmpty: "加载工作区历史后，最近使用的 Session 会显示在这里。",
    favoriteEmpty: "收藏常用会话后，会显示在这里。",
    addWorkspace: "打开工作区",
    workspacePath: "桌面端工作区路径",
    workspacePathPlaceholder: "/home/three/workspace/project",
    openWorkspaceTitle: "打开工作区",
    openWorkspaceHelp: "输入连接的桌面端上存在的路径。",
    closeWorkspaceDialog: "关闭工作区弹窗",
    expandWorkspace: "展开 {name}",
    collapseWorkspace: "折叠 {name}",
    openWorkspace: "打开工作区 {name}",
    newSessionIn: "在 {name} 中新建会话",
    changeIconFor: "更换 {name} 的图标",
    iconPicker: "选择 Session 图标",
    closeIconPicker: "关闭图标选择",
    unreadTurn: "未读 Turn",
    favoriteSession: "收藏 {name}",
    unfavoriteSession: "取消收藏 {name}",
    renameSession: "重命名 {name}",
    sessionName: "会话名称",
    saveSessionName: "保存会话名称",
    cancelRename: "取消重命名",
    chatMessages: "聊天消息",
    loadOlderMessages: "加载 {count} 条更早消息",
    hiddenMessages: "已隐藏 {count} 条",
    loading: "加载中",
    resumingSession: "正在恢复这个桌面端会话...",
    pendingApprovals: "待审批",
    desktopRunningTurn: "桌面端 Codex 正在运行这个 Turn。",
    imageAttachments: "图片附件",
    addImages: "添加图片",
    selectedImages: "已选择图片",
    removeAttachment: "移除 {name}",
    fileMention: "文件提示",
    files: "文件",
    skills: "技能",
    searchFiles: "搜索文件",
    searchSkills: "搜索技能",
    noMatchingFiles: "没有匹配的文件",
    noMatchingSkills: "没有匹配的技能",
    messageCodex: "给 Codex 发消息",
    composerPlaceholder: "在桌面端向 Codex 发消息",
    runtimeSettings: "运行设置",
    runtimeSettingsTitle: "运行设置",
    closeRuntimeSettings: "关闭运行设置",
    stopCurrentTurn: "停止当前 Turn",
    sendMessage: "发送消息",
    sentImages: "已发送图片",
    sentAttachments: "已发送附件",
    mobileSubtitle: "浏览器优先的远程控制界面",
    settingsSubtitle: "远程连接与应用偏好",
    connection: "连接",
    relayEndpoint: "Relay endpoint",
    desktopDeviceId: "桌面端设备",
    desktopDeviceIdFallback: "当前选中的设备 ID",
    loadingDesktopDevices: "正在加载桌面端设备...",
    noDesktopDevices: "这个 API key 下没有在线桌面端设备。",
    refreshDevices: "刷新",
    desktopConnection: "桌面端连接",
    desktopOnline: "桌面端在线",
    desktopOffline: "桌面端未连接",
    apiKey: "API key",
    relayHelp:
      "使用与桌面端相同的 API key。Endpoint 指向 Go relay 服务，在线桌面端设备会自动列出。",
    relayMode: "Relay 模式",
    missingKey: "缺少 key",
    desktop: "桌面端",
    mobileClients: "移动端",
    device: "本机",
    appearance: "外观",
    theme: "主题",
    dark: "深色",
    light: "浅色",
    language: "语言",
    appearanceHelp: "应用到移动端全部界面。",
    model: "模型",
    reasoningLevel: "推理档位",
    activeModel: "当前模型",
    safety: "安全",
    usageLimits: "额度",
    defaultPermissions: "默认 /permissions",
    permissions: "权限",
    workspaceBoundary: "工作区边界",
    enforced: "已限制",
    notifications: "通知",
    systemNotifications: "系统通知",
    notificationVibration: "振动",
    notificationSound: "提示音",
    notificationsHelp:
      "Codex Turn 完成时，Android 可以发出系统通知，并附上简要的 Session 说明；App 在后台运行时也会提示。",
    notConfigured: "未配置",
    developer: "开发",
    androidShell: "Android 壳",
    dataSource: "数据源",
    relaySnapshot: "Relay 快照",
    primary: "主导航",
    approve: "通过",
    decline: "拒绝",
    risk: "{risk} 风险",
    copied: "已复制",
    copy: "复制",
    copyApiKey: "复制 API key",
    copyDesktopDeviceId: "复制桌面端 Device ID",
    copyDeviceId: "复制移动端 Device ID",
    contextUnknown: "未知",
    contextUsed: "已用 {count}",
    contextLeft: "剩余 {count}",
    customApprovalPolicy: "自定义审批策略。",
    notReported: "未上报",
    online: "在线",
    pairing: "配对中",
    offline: "离线",
    disconnected: "断开",
    connecting: "连接中",
    connected: "已连接",
    reconnecting: "正在重连",
    error: "错误",
    disabled: "未启用",
    approval: "待审批"
  }
} as const;

type UIMessageKey = keyof typeof UI_TEXT.en;

const SESSION_ICON_IDS = [
  "terminal",
  "code",
  "branch",
  "bug",
  "rocket",
  "database",
  "globe",
  "palette",
  "shield",
  "test",
  "doc",
  "bot",
  "spark",
  "compass",
  "cube",
  "graph",
  "bolt",
  "key",
  "cloud",
  "chip",
  "package",
  "workflow",
  "search",
  "wrench",
  "flag",
  "book",
  "clock",
  "pin",
  "layers",
  "atom",
  "eye",
  "flame",
  "wave",
  "gem",
  "target",
  "beaker",
  "satellite",
  "lock",
  "brush",
  "grid"
] as const;

type SessionIconId = (typeof SESSION_ICON_IDS)[number];

interface DesktopSnapshotPayload {
  device?: typeof mockSnapshot.device;
  workspaces?: Workspace[];
  activeWorkspace?: string | null;
  sessions?: Session[];
  activeSessionId?: string | null;
  messages?: Message[];
  approvals?: Approval[];
  diffLines?: string[];
  isWorking?: boolean;
  permissionMode?: PermissionMode;
  model?: string;
  modelEffort?: ModelEffort;
  contextUsage?: {
    usedTokens: number;
    contextWindow: number | null;
  } | null;
  rateLimitUsage?: RateLimitUsage | null;
  modelOptions?: ModelOption[];
  status?: string;
}

interface RelayEnvelope {
  type: string;
  payload?: unknown;
}

interface RelayDesktopDevice {
  deviceId: string;
  desktopCount: number;
  clientCount: number;
  connected: boolean;
  lastSeen: string;
}

interface RelayPresence {
  deviceId: string;
  desktopCount: number;
  clientCount: number;
  connected: boolean;
  lastSeen: string;
}

interface PendingRelayCommand {
  id: string;
  message: {
    type: string;
    payload: Record<string, unknown>;
  };
  createdAt: number;
}

interface RelayEventRecord {
  id: number;
  type: string;
  workspace_id?: string;
  session_id?: string;
  title?: string;
  body?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
}

interface PendingImageAttachment {
  id: string;
  kind: "image";
  name: string;
  mimeType: string;
  dataUrl: string;
}

interface PendingMentionAttachment {
  id: string;
  kind: "mention";
  name: string;
  path: string;
}

type PendingComposerAttachment = PendingImageAttachment | PendingMentionAttachment;

interface ComposerSuggestion {
  id: string;
  type: ComposerCompletionMode;
  label: string;
  name: string;
  detail?: string;
  insertText: string;
  path?: string;
}

interface ComposerCompletion {
  mode: ComposerCompletionMode;
  query: string;
  tokenStart: number;
  cursor: number;
  items: ComposerSuggestion[];
  selectedIndex: number;
  loading: boolean;
  requestId: string;
}

interface TurnCompleteNotificationSettings {
  enabled: boolean;
  sound: boolean;
  vibration: boolean;
}

export function App() {
  const [activeView, setActiveView] = useState<ViewMode>(() => initialViewMode());
  const [device, setDevice] = useState(mockSnapshot.device);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(mockSnapshot.workspaces);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(
    mockSnapshot.activeWorkspace
  );
  const [sessions, setSessions] = useState(mockSnapshot.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    mockSnapshot.activeSessionId
  );
  const [sessionTab, setSessionTab] = useState<SessionTab>("recent");
  const [favoriteSessionIds, setFavoriteSessionIds] = useState<Set<string>>(
    () => new Set(readStringList(FAVORITE_SESSIONS_STORAGE_KEY))
  );
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(
    () => new Set(readStringList(COLLAPSED_WORKSPACES_STORAGE_KEY))
  );
  const [composer, setComposer] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingComposerAttachment[]
  >([]);
  const [composerCompletion, setComposerCompletion] =
    useState<ComposerCompletion | null>(null);
  const [isWorkspaceDialogOpen, setIsWorkspaceDialogOpen] = useState(false);
  const [workspacePathDraft, setWorkspacePathDraft] = useState("");
  const [messages, setMessages] = useState(mockSnapshot.messages);
  const [approvals, setApprovals] = useState(mockSnapshot.approvals);
  const [diffLines, setDiffLines] = useState(mockSnapshot.diffLines);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    mockSnapshot.permissionMode
  );
  const [model, setModel] = useState(mockSnapshot.model);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(
    mockSnapshot.modelOptions ?? MODEL_OPTIONS.map(option => ({ id: option, label: option }))
  );
  const [modelEffort, setModelEffort] = useState<ModelEffort>(mockSnapshot.modelEffort);
  const [contextUsage, setContextUsage] = useState(mockSnapshot.contextUsage);
  const [rateLimitUsage, setRateLimitUsage] = useState<RateLimitUsage | null>(
    mockSnapshot.rateLimitUsage ?? null
  );
  const [desktopStatus, setDesktopStatus] = useState(mockSnapshot.status ?? "");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readSavedThemeMode());
  const [language, setLanguage] = useState<UILanguage>(() => readSavedLanguage());
  const [isWorking, setIsWorking] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [isRuntimeSettingsOpen, setIsRuntimeSettingsOpen] = useState(false);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [visibleMessageCount, setVisibleMessageCount] = useState(
    INITIAL_VISIBLE_MESSAGE_COUNT
  );
  const [scrollRequest, setScrollRequest] = useState(0);
  const [historyLoadRequest, setHistoryLoadRequest] = useState(0);
  const [relayEndpoint, setRelayEndpoint] = useState(
    () => readSavedRelayEndpoint()
  );
  const [relayApiKey, setRelayApiKey] = useState(
    () => window.localStorage.getItem(RELAY_API_KEY_STORAGE_KEY) ?? ""
  );
  const [desktopDeviceId, setDesktopDeviceId] = useState(
    () => window.localStorage.getItem(RELAY_DESKTOP_DEVICE_ID_STORAGE_KEY) ?? ""
  );
  const [desktopDevices, setDesktopDevices] = useState<RelayDesktopDevice[]>([]);
  const [isDesktopDevicesLoading, setIsDesktopDevicesLoading] = useState(false);
  const [desktopDevicesError, setDesktopDevicesError] = useState("");
  const [desktopDevicesRefreshKey, setDesktopDevicesRefreshKey] = useState(0);
  const [systemNotificationsEnabled, setSystemNotificationsEnabled] = useState(() =>
    readBooleanStorage(SYSTEM_NOTIFICATIONS_ENABLED_STORAGE_KEY, true)
  );
  const [notificationVibrationEnabled, setNotificationVibrationEnabled] = useState(() =>
    readBooleanStorage(NOTIFICATION_VIBRATION_ENABLED_STORAGE_KEY, true)
  );
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(() =>
    readBooleanStorage(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, true)
  );
  const [relayState, setRelayState] = useState<RelayConnectionState>("disabled");
  const [relayError, setRelayError] = useState("");
  const [relayPresence, setRelayPresence] = useState<RelayPresence | null>(null);
  const [deviceId] = useState(() => storedDeviceId());
  const relaySocketRef = useRef<WebSocket | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  const lastRelayEventIdRef = useRef(readLastRelayEventId());
  const pendingRelayCommandsRef = useRef<Record<string, PendingRelayCommand>>(
    readPendingRelayCommands()
  );
  const composerCompletionRequestRef = useRef(0);
  const notificationSettingsRef = useRef({
    enabled: systemNotificationsEnabled,
    sound: notificationSoundEnabled,
    vibration: notificationVibrationEnabled
  });
  const appForegroundRef = useRef(isAppForeground());
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const previousHistoryScrollHeight = useRef(0);
  const visibleWorkspaces = useMemo(() => {
    if (workspaces.length > 0) {
      return workspaces;
    }
    if (!device.workspace) {
      return [];
    }
    return [
      {
        path: device.workspace,
        name: workspaceName(device.workspace),
        sessions
      }
    ];
  }, [device.workspace, sessions, workspaces]);
  useEffect(() => {
    setSessionTab("recent");
  }, []);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  useEffect(() => {
    notificationSettingsRef.current = {
      enabled: systemNotificationsEnabled,
      sound: notificationSoundEnabled,
      vibration: notificationVibrationEnabled
    };
  }, [
    notificationSoundEnabled,
    notificationVibrationEnabled,
    systemNotificationsEnabled
  ]);
  useEffect(() => {
    const updateAppForeground = () => {
      appForegroundRef.current = isAppForeground();
    };

    updateAppForeground();
    document.addEventListener("visibilitychange", updateAppForeground);
    window.addEventListener("focus", updateAppForeground);
    window.addEventListener("blur", updateAppForeground);
    return () => {
      document.removeEventListener("visibilitychange", updateAppForeground);
      window.removeEventListener("focus", updateAppForeground);
      window.removeEventListener("blur", updateAppForeground);
    };
  }, []);
  useEffect(() => {
    if (!systemNotificationsEnabled) {
      void cleanupTurnCompleteNotificationChannels({
        sound: notificationSoundEnabled,
        vibration: notificationVibrationEnabled
      });
      return;
    }
    void ensureTurnCompleteNotificationReady({
      sound: notificationSoundEnabled,
      vibration: notificationVibrationEnabled
    });
  }, [
    notificationSoundEnabled,
    notificationVibrationEnabled,
    systemNotificationsEnabled
  ]);

  useEffect(() => {
    if (activeView !== "sessions") {
      return;
    }
    publishReliableRelayCommand("client.refresh_sessions");
  }, [activeView, relayState]);

  const activeSession =
    visibleWorkspaces
      .flatMap(workspace => workspace.sessions)
      .find(session => session.id === activeSessionId) ??
    sessions.find(session => session.id === activeSessionId) ??
    sessions[0];
  const hasUnreadSessions = visibleWorkspaces.some(workspace =>
    workspace.sessions.some(session => session.unread)
  );
  const displayMessages = useMemo(
    () => messages.filter(message => !isHiddenChatMessage(message)),
    [messages]
  );
  const latestDisplayMessageId =
    displayMessages.length > 0 ? displayMessages[displayMessages.length - 1].id : "";
  const hiddenMessageCount = Math.max(displayMessages.length - visibleMessageCount, 0);
  const visibleMessages = useMemo(
    () => displayMessages.slice(hiddenMessageCount),
    [displayMessages, hiddenMessageCount]
  );
  const activeTurnElapsedMs =
    activeSession?.turnStartedAt && activeSession.status === "working"
      ? timerNow - activeSession.turnStartedAt
      : null;
  const visibleTurnDurationMs = activeTurnElapsedMs ?? activeSession?.lastTurnDurationMs ?? null;

  const t = (key: UIMessageKey, values?: Record<string, string | number>) =>
    textFor(language, key, values);
  const headerRuntimeValues = [
    contextLabel(contextUsage, language),
    model,
    effortLabel(modelEffort, language),
    permissionLabel(permissionMode, language)
  ].filter(Boolean);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      flushPendingRelayCommands();
    }, RELIABLE_RELAY_RETRY_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!composerCompletion) {
      return undefined;
    }

    const { mode, query, requestId } = composerCompletion;
    const timer = window.setTimeout(() => {
      publishRelay({
        type: "client.search_composer",
        payload: {
          requestId,
          mode,
          query,
          workspace: activeWorkspace ?? "",
          limit: 36
        }
      });
    }, 90);

    return () => window.clearTimeout(timer);
  }, [activeWorkspace, composerCompletion?.mode, composerCompletion?.query, composerCompletion?.requestId]);

  useEffect(() => {
    if (!relayEndpoint.trim() || !relayApiKey.trim()) {
      setDesktopDevices([]);
      setIsDesktopDevicesLoading(false);
      setDesktopDevicesError("");
      return undefined;
    }

    const devicesUrl = relayDevicesURL(relayEndpoint);
    if (!devicesUrl) {
      setDesktopDevices([]);
      setIsDesktopDevicesLoading(false);
      setDesktopDevicesError(`Invalid relay endpoint: ${relayEndpoint}`);
      return undefined;
    }

    let cancelled = false;
    setIsDesktopDevicesLoading(true);
    setDesktopDevicesError("");

    fetch(devicesUrl, {
      headers: {
        "X-CodeP-Api-Key": relayApiKey.trim()
      }
    })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(errorMessageFromBody(body) || `HTTP ${response.status}`);
        }
        return relayDesktopDevicesFromPayload(body);
      })
      .then(devices => {
        if (cancelled) {
          return;
        }
        setDesktopDevices(devices);
        if (devices.length === 0 && desktopDeviceId === "desktop-main") {
          setDesktopDeviceId("");
          window.localStorage.removeItem(RELAY_DESKTOP_DEVICE_ID_STORAGE_KEY);
          return;
        }
        const selectedStillAvailable = devices.some(
          device => device.deviceId === desktopDeviceId
        );
        const preferred = devices.find(device => device.connected) ?? devices[0];
        if (preferred && (!selectedStillAvailable || desktopDeviceId === "desktop-main")) {
          setDesktopDeviceId(preferred.deviceId);
          window.localStorage.setItem(RELAY_DESKTOP_DEVICE_ID_STORAGE_KEY, preferred.deviceId);
        }
      })
      .catch(error => {
        if (cancelled) {
          return;
        }
        setDesktopDevices([]);
        setDesktopDevicesError(
          error instanceof Error ? error.message : "Unable to load desktop devices."
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsDesktopDevicesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [desktopDeviceId, desktopDevicesRefreshKey, relayApiKey, relayEndpoint]);

  useEffect(() => {
    if (!relayEndpoint.trim() || !relayApiKey.trim() || !desktopDeviceId.trim()) {
      relaySocketRef.current?.close();
      relaySocketRef.current = null;
      setRelayState("disabled");
      setRelayError("");
      setRelayPresence(null);
      return undefined;
    }

    const relayUrl = relayWebSocketURL(
      relayEndpoint,
      "client",
      desktopDeviceId,
      relayApiKey,
      deviceId
    );
    if (!relayUrl) {
      relaySocketRef.current?.close();
      relaySocketRef.current = null;
      setRelayState("error");
      setRelayError(`Invalid relay endpoint: ${relayEndpoint}`);
      setRelayPresence(null);
      return undefined;
    }

    let stopped = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = (reason: string) => {
      if (stopped || reconnectTimer !== null) {
        return;
      }
      const delay = Math.min(
        RELAY_RECONNECT_MAX_MS,
        RELAY_RECONNECT_BASE_MS * 2 ** reconnectAttempt
      );
      reconnectAttempt += 1;
      setRelayState("reconnecting");
      setRelayError(`${reason}. Reconnecting in ${Math.ceil(delay / 1000)}s.`);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      clearReconnectTimer();
      if (stopped) {
        return;
      }

      setRelayState("connecting");
      if (reconnectAttempt === 0) {
        setRelayError("");
      }
      const socket = new WebSocket(relayUrl);
      relaySocketRef.current = socket;

      socket.addEventListener("open", () => {
        if (relaySocketRef.current !== socket || stopped) {
          return;
        }
        reconnectAttempt = 0;
        setRelayState("connected");
        setRelayError("");
        setRelayPresence(null);
        flushPendingRelayCommands();
        publishRelay({
          type: "client.resume_events",
          payload: { last_event_id: lastRelayEventIdRef.current }
        });
      });
      socket.addEventListener("message", event => {
        if (relaySocketRef.current === socket && !stopped) {
          applyRelayMessage(event.data);
        }
      });
      socket.addEventListener("close", () => {
        if (relaySocketRef.current === socket) {
          relaySocketRef.current = null;
          setRelayPresence(null);
          scheduleReconnect(`Relay connection closed: ${relayUrl}`);
        }
      });
      socket.addEventListener("error", () => {
        if (relaySocketRef.current === socket) {
          scheduleReconnect(`Relay connection failed: ${relayUrl}`);
          socket.close();
        }
      });
    };

    const reconnectNow = () => {
      if (stopped) {
        return;
      }
      clearReconnectTimer();
      const socket = relaySocketRef.current;
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        reconnectAttempt = 0;
        connect();
      }
    };

    window.addEventListener("online", reconnectNow);
    connect();

    return () => {
      stopped = true;
      clearReconnectTimer();
      window.removeEventListener("online", reconnectNow);
      const socket = relaySocketRef.current;
      relaySocketRef.current = null;
      setRelayPresence(null);
      socket?.close();
    };
  }, [desktopDeviceId, deviceId, relayApiKey, relayEndpoint]);

  useEffect(() => {
    resetVisibleMessageWindow();
    requestScrollToBottom();
  }, [activeSessionId]);

  useEffect(() => {
    requestScrollToBottom();
  }, [approvals.length, isWorking, latestDisplayMessageId]);

  useEffect(() => {
    if (scrollRequest === 0) {
      return undefined;
    }

    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const element = messageListRef.current;
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
  }, [activeSessionId, scrollRequest, visibleMessages.length]);

  useEffect(() => {
    if (historyLoadRequest === 0) {
      return undefined;
    }

    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const element = messageListRef.current;
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

  function requestScrollToBottom() {
    setScrollRequest(previous => previous + 1);
  }

  function resetVisibleMessageWindow() {
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGE_COUNT);
  }

  function loadOlderMessages() {
    const element = messageListRef.current;
    previousHistoryScrollHeight.current = element?.scrollHeight ?? 0;
    setVisibleMessageCount(previous =>
      Math.min(previous + MESSAGE_PAGE_SIZE, displayMessages.length)
    );
    setHistoryLoadRequest(previous => previous + 1);
  }

  function sendMessage() {
    const text = composer.trim();
    const outgoingAttachments = pendingAttachments;
    if (text.length === 0 && outgoingAttachments.length === 0) {
      return;
    }
    const targetSessionId = activeSessionIdRef.current ?? activeSession?.id ?? "";
    if (!targetSessionId || isSessionLoading) {
      setDesktopStatus(t("resumingSession"));
      return;
    }
    const targetWorkspace =
      activeWorkspace ??
      (targetSessionId ? workspaceForSession(visibleWorkspaces, targetSessionId)?.path : null) ??
      "";

    setMessages(previous => [
      ...previous,
      {
        id: `local-${Date.now()}`,
        role: "user",
        text: text.length > 0 ? text : t("sentAttachments"),
        attachments: outgoingAttachments
          .filter((attachment): attachment is PendingImageAttachment => attachment.kind === "image")
          .map(attachment => ({
            id: attachment.id,
            kind: attachment.kind,
            name: attachment.name,
            mimeType: attachment.mimeType,
            dataUrl: attachment.dataUrl
          }))
      }
    ]);
    setComposer("");
    setPendingAttachments([]);
    setIsWorking(true);
    setActiveView("chat");
    resetVisibleMessageWindow();
    requestScrollToBottom();
    publishReliableRelayCommand("client.send_message", {
      workspace: targetWorkspace,
      sessionId: targetSessionId,
      text,
      attachments: outgoingAttachments.map(attachment =>
        attachment.kind === "image"
          ? {
              kind: attachment.kind,
              name: attachment.name,
              mimeType: attachment.mimeType,
              dataUrl: attachment.dataUrl
            }
          : {
              kind: attachment.kind,
              name: attachment.name,
              path: attachment.path
            }
      )
    });
  }

  async function addImageAttachments(files: FileList | File[]) {
    const imageFiles = Array.from(files).filter(isImageFile);
    if (imageFiles.length === 0) {
      return;
    }

    const nextAttachments = await Promise.all(
      imageFiles.map(async file => {
        const mimeType = imageMimeTypeForFile(file);
        return {
          id: `${file.name}-${file.lastModified}-${uniqueId()}`,
          kind: "image" as const,
          name: file.name || `image-${Date.now()}.png`,
          mimeType,
          dataUrl: normalizeImageDataUrl(await readFileAsDataUrl(file), mimeType)
        };
      })
    );
    setPendingAttachments(previous => [...previous, ...nextAttachments]);
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments(previous => previous.filter(attachment => attachment.id !== id));
  }

  function handleComposerChange(value: string, cursor: number) {
    setComposer(value);
    updateComposerCompletion(value, cursor);
  }

  function updateComposerCompletion(value: string, cursor: number) {
    const trigger = activeComposerTrigger(value, cursor);
    if (!trigger || !activeSession) {
      setComposerCompletion(null);
      return;
    }

    setComposerCompletion(current => {
      const requestId =
        current?.mode === trigger.mode && current.query === trigger.query
          ? current.requestId
          : `completion-${Date.now()}-${++composerCompletionRequestRef.current}`;
      return {
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
        loading: true,
        requestId
      };
    });
  }

  function openComposerCompletion(mode: ComposerCompletionMode, cursor: number) {
    if (!activeSession) {
      return;
    }
    setComposerCompletion({
      mode,
      query: "",
      tokenStart: cursor,
      cursor,
      items: [],
      selectedIndex: 0,
      loading: true,
      requestId: `completion-${Date.now()}-${++composerCompletionRequestRef.current}`
    });
  }

  function closeComposerCompletion() {
    setComposerCompletion(null);
  }

  function moveComposerCompletionSelection(direction: 1 | -1) {
    setComposerCompletion(current => {
      if (!current || current.items.length === 0) {
        return current;
      }
      return {
        ...current,
        selectedIndex:
          (current.selectedIndex + direction + current.items.length) %
          current.items.length
      };
    });
  }

  function selectComposerCompletion(item: ComposerSuggestion) {
    if (!composerCompletion) {
      return;
    }

    const suffix = composer.slice(composerCompletion.cursor);
    const insertText = `${item.insertText} `;
    const nextComposer = `${composer.slice(0, composerCompletion.tokenStart)}${insertText}${suffix}`;
    setComposer(nextComposer);
    setComposerCompletion(null);

    const mentionPath = item.type === "file" ? item.path : undefined;
    if (mentionPath) {
      setPendingAttachments(previous => {
        if (
          previous.some(
            attachment =>
              attachment.kind === "mention" && attachment.path === mentionPath
          )
        ) {
          return previous;
        }
        return [
          ...previous,
          {
            id: `${mentionPath}-${Date.now()}`,
            kind: "mention",
            name: item.name,
            path: mentionPath
          }
        ];
      });
    }
  }

  function interruptDesktop() {
    setIsWorking(false);
    publishReliableRelayCommand("client.interrupt");
  }

  function openSession(sessionId: string) {
    const targetWorkspace = workspaceForSession(visibleWorkspaces, sessionId);
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    markSessionRead(sessionId);
    setMessages([]);
    setIsSessionLoading(true);
    if (targetWorkspace) {
      setActiveWorkspace(targetWorkspace.path);
      publishReliableRelayCommand("client.open_session", {
        workspace: targetWorkspace.path,
        sessionId
      });
    }
    setActiveView("chat");
  }

  function markSessionRead(sessionId: string) {
    setWorkspaces(previous =>
      previous.map(workspace => ({
        ...workspace,
        sessions: workspace.sessions.map(session =>
          session.id === sessionId ? { ...session, unread: false } : session
        )
      }))
    );
    setSessions(previous =>
      previous.map(session =>
        session.id === sessionId ? { ...session, unread: false } : session
      )
    );
  }

  function startSessionInWorkspace(workspace: string) {
    setActiveWorkspace(workspace);
    setMessages([]);
    setIsSessionLoading(true);
    publishReliableRelayCommand("client.new_session", { workspace });
    setActiveView("chat");
  }

  function openWorkspace(workspace: string) {
    setActiveWorkspace(workspace);
    setActiveSessionId(null);
    setMessages([]);
    setApprovals([]);
    setIsSessionLoading(true);
    publishReliableRelayCommand("client.open_workspace", { workspace });
    setActiveView("chat");
  }

  function openWorkspacePath(path: string) {
    const workspace = path.trim();
    if (!workspace) {
      return;
    }
    setIsWorkspaceDialogOpen(false);
    setWorkspacePathDraft("");
    setActiveWorkspace(workspace);
    setActiveSessionId(null);
    setMessages([]);
    setApprovals([]);
    setIsSessionLoading(true);
    publishReliableRelayCommand("client.open_workspace_path", { workspace });
    setActiveView("chat");
  }

  function renameSession(workspace: string, session: Session, nextTitle: string) {
    const title = nextTitle.trim();
    if (!title || title === session.title) {
      return;
    }

    setWorkspaces(previous =>
      previous.map(item =>
        item.path === workspace
          ? {
              ...item,
              sessions: item.sessions.map(existing =>
                existing.id === session.id ? { ...existing, title } : existing
              )
            }
          : item
      )
    );
    setSessions(previous =>
      previous.map(existing =>
        existing.id === session.id ? { ...existing, title } : existing
      )
    );
    publishReliableRelayCommand("client.rename_session", {
      workspace,
      sessionId: session.id,
      title
    });
  }

  function updateSessionIcon(sessionId: string, iconId: SessionIconId) {
    setWorkspaces(previous =>
      previous.map(workspace => ({
        ...workspace,
        sessions: workspace.sessions.map(session =>
          session.id === sessionId ? { ...session, iconId } : session
        )
      }))
    );
    setSessions(previous =>
      previous.map(session => (session.id === sessionId ? { ...session, iconId } : session))
    );
    publishReliableRelayCommand("client.set_session_icon", { sessionId, iconId });
  }

  function toggleFavoriteSession(sessionId: string) {
    const session =
      visibleWorkspaces
        .flatMap(workspace => workspace.sessions)
        .find(item => item.id === sessionId) ??
      sessions.find(item => item.id === sessionId);
    const nextFavorite = session
      ? !isSessionFavorite(session, favoriteSessionIds)
      : !favoriteSessionIds.has(sessionId);

    setFavoriteSessionIds(previous => {
      const next = new Set(previous);
      if (nextFavorite) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      saveStringList(FAVORITE_SESSIONS_STORAGE_KEY, Array.from(next));
      return next;
    });
    setWorkspaces(previous =>
      previous.map(workspace => ({
        ...workspace,
        sessions: workspace.sessions.map(session =>
          session.id === sessionId ? { ...session, favorite: nextFavorite } : session
        )
      }))
    );
    setSessions(previous =>
      previous.map(session =>
        session.id === sessionId ? { ...session, favorite: nextFavorite } : session
      )
    );
    publishReliableRelayCommand("client.set_session_favorite", {
      sessionId,
      favorite: nextFavorite
    });
  }

  function toggleWorkspaceCollapsed(workspace: string) {
    setCollapsedWorkspaces(previous => {
      const next = new Set(previous);
      if (next.has(workspace)) {
        next.delete(workspace);
      } else {
        next.add(workspace);
      }
      saveStringList(COLLAPSED_WORKSPACES_STORAGE_KEY, Array.from(next));
      return next;
    });
  }

  function resolveApproval(approvalId: string, decision: "accept" | "decline") {
    setApprovals(previous => previous.filter(item => item.id !== approvalId));
    publishReliableRelayCommand("client.resolve_approval", {
      requestId: approvalId,
      decision
    });
  }

  function updateRelayEndpoint(value: string) {
    const normalized = normalizedRelayEndpoint(value);
    setRelayEndpoint(normalized);
    window.localStorage.setItem(RELAY_ENDPOINT_STORAGE_KEY, normalized);
  }

  function updateRelayApiKey(value: string) {
    setRelayApiKey(value);
    window.localStorage.setItem(RELAY_API_KEY_STORAGE_KEY, value);
  }

  function updateDesktopDeviceId(value: string) {
    setDesktopDeviceId(value);
    window.localStorage.setItem(RELAY_DESKTOP_DEVICE_ID_STORAGE_KEY, value);
  }

  function updatePermissionMode(value: PermissionMode) {
    setPermissionMode(value);
    publishReliableRelayCommand("client.set_permissions", { permissionMode: value });
  }

  function updateModel(value: string) {
    const nextModel = value.trim();
    if (!nextModel) {
      return;
    }
    setModel(nextModel);
    publishReliableRelayCommand("client.set_model", {
      model: nextModel,
      effort: modelEffort
    });
  }

  function updateModelEffort(value: ModelEffort) {
    setModelEffort(value);
    publishReliableRelayCommand("client.set_model", { model, effort: value });
  }

  function updateThemeMode(value: ThemeMode) {
    setThemeMode(value);
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  }

  function updateLanguage(value: UILanguage) {
    setLanguage(value);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  }

  function updateSystemNotificationsEnabled(value: boolean) {
    setSystemNotificationsEnabled(value);
    writeBooleanStorage(SYSTEM_NOTIFICATIONS_ENABLED_STORAGE_KEY, value);
    if (value) {
      void ensureTurnCompleteNotificationReady({
        sound: notificationSoundEnabled,
        vibration: notificationVibrationEnabled
      });
    }
  }

  function updateNotificationVibrationEnabled(value: boolean) {
    setNotificationVibrationEnabled(value);
    writeBooleanStorage(NOTIFICATION_VIBRATION_ENABLED_STORAGE_KEY, value);
    if (systemNotificationsEnabled) {
      void ensureTurnCompleteNotificationReady({
        sound: notificationSoundEnabled,
        vibration: value
      });
    }
  }

  function updateNotificationSoundEnabled(value: boolean) {
    setNotificationSoundEnabled(value);
    writeBooleanStorage(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, value);
    if (systemNotificationsEnabled) {
      void ensureTurnCompleteNotificationReady({
        sound: value,
        vibration: notificationVibrationEnabled
      });
    }
  }

  function applyRelayMessage(data: unknown) {
    const envelope = parseRelayEnvelope(data);
    if (!envelope) {
      return;
    }

    if (envelope.type === "client.command_ack") {
      const id = clientCommandAckId(envelope.payload);
      if (id) {
        forgetPendingRelayCommand(id);
      }
      return;
    }

    if (envelope.type === "relay.presence") {
      const presence = relayPresenceFromPayload(envelope.payload);
      setRelayPresence(presence);
      setDesktopDevices(previous =>
        previous.map(device =>
          device.deviceId === presence.deviceId
            ? {
                ...device,
                desktopCount: presence.desktopCount,
                clientCount: presence.clientCount,
                connected: presence.connected,
                lastSeen: presence.lastSeen
              }
            : device
        )
      );
      return;
    }

    if (envelope.type === "event.deliver") {
      const event = relayEventFromPayload(envelope.payload);
      if (event) {
        handleRelayEvent(event);
      }
      return;
    }

    if (envelope.type === "event.backlog") {
      const backlogEvents = relayEventsFromBacklog(envelope.payload);
      for (const event of backlogEvents) {
        handleRelayEvent(event);
      }
      if (backlogEvents.length > 0) {
        publishRelay({
          type: "client.resume_events",
          payload: { last_event_id: lastRelayEventIdRef.current }
        });
      }
      return;
    }

    if (envelope.type === "desktop.composer_suggestions") {
      const payload = asRecord(envelope.payload);
      const requestId =
        typeof payload.requestId === "string" ? payload.requestId : "";
      const items = composerSuggestionsFromPayload(payload.items);
      setComposerCompletion(current => {
        if (!current || current.requestId !== requestId) {
          return current;
        }
        return {
          ...current,
          items,
          selectedIndex: Math.min(current.selectedIndex, Math.max(items.length - 1, 0)),
          loading: false
        };
      });
      return;
    }

    if (envelope.type === "desktop.progress") {
      applyDesktopProgress(envelope.payload);
      return;
    }

    if (envelope.type === "desktop.event") {
      applyDesktopEvent(envelope.payload);
      return;
    }

    if (envelope.type !== "desktop.snapshot" || !envelope.payload) {
      return;
    }
    applyDesktopSnapshot(envelope.payload as DesktopSnapshotPayload);
  }

  function applyDesktopProgress(payload: unknown) {
    const record = asRecord(payload);
    const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
    if (sessionId && activeSessionIdRef.current && sessionId !== activeSessionIdRef.current) {
      return;
    }
    const message = remoteMessageFromPayload(record.message);
    const event = remoteMessageFromPayload(record.event);
    if (message) {
      upsertRemoteMessage(message);
    }
    if (event) {
      upsertRemoteMessage(event);
    }
    if (typeof record.isWorking === "boolean") {
      setIsWorking(record.isWorking);
    }
  }

  function applyDesktopEvent(payload: unknown) {
    const event = asRecord(asRecord(payload).event);
    const sessionId =
      typeof event.threadId === "string" ? event.threadId : "";
    if (sessionId && activeSessionIdRef.current && sessionId !== activeSessionIdRef.current) {
      return;
    }
    const text = firstText(
      event.patch,
      event.diff,
      event.plan,
      event.summary
    );
    if (!text) {
      return;
    }
    const type = typeof event.type === "string" ? event.type : "desktop.event";
    const turnId = typeof event.turnId === "string" ? event.turnId : "";
    upsertRemoteMessage({
      id: `event-${type}-${turnId || sessionId || Date.now()}`,
      role: "event",
      text,
      meta: type
    });
  }

  function upsertRemoteMessage(message: Message) {
    setMessages(previous => {
      const existingIndex = previous.findIndex(item => item.id === message.id);
      const next =
        existingIndex >= 0
          ? previous.map(item => item.id === message.id ? message : item)
          : [...previous, message];
      return next.length > 240 ? next.slice(next.length - 240) : next;
    });
  }

  function applyDesktopSnapshot(snapshot: DesktopSnapshotPayload) {
    if (snapshot.device) {
      setDevice(snapshot.device);
    }
    if (snapshot.workspaces) {
      setWorkspaces(snapshot.workspaces);
    }
    if (snapshot.activeWorkspace !== undefined) {
      setActiveWorkspace(snapshot.activeWorkspace);
    }
    if (snapshot.sessions) {
      setSessions(snapshot.sessions);
    }
    if (snapshot.activeSessionId !== undefined) {
      activeSessionIdRef.current = snapshot.activeSessionId;
      setActiveSessionId(snapshot.activeSessionId);
    }
    if (snapshot.messages) {
      setMessages(snapshot.messages);
      setIsSessionLoading(false);
    }
    if (snapshot.approvals) {
      setApprovals(snapshot.approvals);
    }
    if (snapshot.diffLines) {
      setDiffLines(snapshot.diffLines);
    }
    if (snapshot.permissionMode && isPermissionMode(snapshot.permissionMode)) {
      setPermissionMode(snapshot.permissionMode);
    }
    if (typeof snapshot.model === "string" && snapshot.model.length > 0) {
      setModel(snapshot.model);
    }
    if (snapshot.modelEffort && isModelEffort(snapshot.modelEffort)) {
      setModelEffort(snapshot.modelEffort);
    }
    if (snapshot.contextUsage !== undefined) {
      setContextUsage(snapshot.contextUsage);
    }
    if (snapshot.rateLimitUsage !== undefined) {
      setRateLimitUsage(snapshot.rateLimitUsage);
    }
    if (snapshot.modelOptions && snapshot.modelOptions.length > 0) {
      setModelOptions(snapshot.modelOptions);
    }
    if (typeof snapshot.status === "string") {
      setDesktopStatus(snapshot.status);
    }
    if (typeof snapshot.isWorking === "boolean") {
      setIsWorking(snapshot.isWorking);
    }
  }

  function handleRelayEvent(event: RelayEventRecord) {
    if (!Number.isFinite(event.id) || event.id <= 0) {
      return;
    }

    const alreadyProcessed = event.id <= lastRelayEventIdRef.current;
    if (!alreadyProcessed && event.type === "desktop.snapshot") {
      const snapshot = snapshotFromRelayEvent(event);
      if (snapshot) {
        applyDesktopSnapshot(snapshot);
      }
    }
    if (!alreadyProcessed && event.type === "turn.completed") {
      const sessionId = event.session_id ?? "";
      const activeRelaySessionId = activeSessionIdRef.current;
      void notifyTurnCompleted(
        event,
        notificationSettingsRef.current,
        appForegroundRef.current
      );
      const payload = asRecord(event.payload);
      const durationMs =
        typeof payload.duration_ms === "number" ? payload.duration_ms : null;
      if (sessionId) {
        setWorkspaces(previous =>
          previous.map(workspace => ({
            ...workspace,
            sessions: workspace.sessions.map(session =>
              session.id === sessionId
                ? {
                    ...session,
                    status: "ready",
                    unread: session.id !== activeRelaySessionId,
                    lastTurnDurationMs: durationMs ?? session.lastTurnDurationMs ?? null,
                    turnStartedAt: null
                  }
                : session
            )
          }))
        );
        setSessions(previous =>
          previous.map(session =>
            session.id === sessionId
              ? {
                  ...session,
                  status: "ready",
                  unread: session.id !== activeRelaySessionId,
                  lastTurnDurationMs: durationMs ?? session.lastTurnDurationMs ?? null,
                  turnStartedAt: null
                }
              : session
          )
        );
      }
      if (sessionId && sessionId === activeRelaySessionId) {
        setIsWorking(false);
        setDesktopStatus(event.body || event.title || "Turn completed.");
      }
    }

    lastRelayEventIdRef.current = rememberRelayEventId(
      lastRelayEventIdRef.current,
      event.id
    );
    publishRelay({
      type: "event.ack",
      payload: { last_event_id: lastRelayEventIdRef.current }
    });
  }

  function publishRelay(message: { type: string; payload?: Record<string, unknown> }) {
    sendRelayMessage(message);
  }

  function publishReliableRelayCommand(type: string, payload: Record<string, unknown> = {}) {
    prunePendingRelayCommands();
    const id = `${deviceId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const message = {
      type,
      payload: {
        ...payload,
        client_message_id: id
      }
    };
    pendingRelayCommandsRef.current = {
      ...pendingRelayCommandsRef.current,
      [id]: {
        id,
        message,
        createdAt: Date.now()
      }
    };
    writePendingRelayCommands(pendingRelayCommandsRef.current);
    sendRelayMessage(message);
  }

  function flushPendingRelayCommands() {
    prunePendingRelayCommands();
    for (const pending of Object.values(pendingRelayCommandsRef.current)) {
      sendRelayMessage(pending.message);
    }
  }

  function prunePendingRelayCommands() {
    const now = Date.now();
    const next = Object.fromEntries(
      Object.entries(pendingRelayCommandsRef.current).filter(([, pending]) => {
        return now - pending.createdAt <= PENDING_RELAY_COMMAND_MAX_AGE_MS;
      })
    );
    if (Object.keys(next).length === Object.keys(pendingRelayCommandsRef.current).length) {
      return;
    }
    pendingRelayCommandsRef.current = next;
    writePendingRelayCommands(next);
  }

  function forgetPendingRelayCommand(id: string) {
    if (!pendingRelayCommandsRef.current[id]) {
      return;
    }
    const next = { ...pendingRelayCommandsRef.current };
    delete next[id];
    pendingRelayCommandsRef.current = next;
    writePendingRelayCommands(next);
  }

  function sendRelayMessage(message: { type: string; payload?: Record<string, unknown> }) {
    const socket = relaySocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  }

  return (
    <main className="mobileShell">
      {isRuntimeSettingsOpen ? (
        <RuntimeSettingsModal
          language={language}
          model={model}
          modelEffort={modelEffort}
          modelOptions={modelOptions}
          onClose={() => setIsRuntimeSettingsOpen(false)}
          onModelChange={updateModel}
          onModelEffortChange={updateModelEffort}
          onPermissionModeChange={updatePermissionMode}
          permissionMode={permissionMode}
          t={t}
        />
      ) : null}
      {isWorkspaceDialogOpen ? (
        <WorkspacePathModal
          onClose={() => setIsWorkspaceDialogOpen(false)}
          onOpen={openWorkspacePath}
          onPathChange={setWorkspacePathDraft}
          path={workspacePathDraft}
          t={t}
        />
      ) : null}

      <section className="pageViewport" aria-live="polite">
        {activeView === "sessions" ? (
          <div className="pageFrame">
            <PageHeader
              action={
                <button
                  aria-label={t("addWorkspace")}
                  className="headerSettingsButton"
                  type="button"
                  onClick={() => setIsWorkspaceDialogOpen(true)}
                >
                  <FolderOpen size={18} />
                </button>
              }
              title={t("sessions")}
              subtitle={t("sessionsSubtitle")}
            />
            <SessionsPage
              activeSessionId={activeSessionId}
              activeWorkspace={activeWorkspace}
              collapsedWorkspaces={collapsedWorkspaces}
              favoriteSessionIds={favoriteSessionIds}
              onOpenSession={openSession}
              onOpenWorkspace={openWorkspace}
              onSessionIconChange={updateSessionIcon}
              onRenameSession={renameSession}
              onStartSession={startSessionInWorkspace}
              onTabChange={setSessionTab}
              onToggleFavorite={toggleFavoriteSession}
              onToggleWorkspace={toggleWorkspaceCollapsed}
              sessionTab={sessionTab}
              t={t}
              workspaces={visibleWorkspaces}
            />
          </div>
        ) : null}
        {activeView === "chat" ? (
          <div className="pageFrame">
            <PageHeader
              action={
                <>
                  <HeaderConnectionStatus
                    language={language}
                    relayError={relayError}
                    relayPresence={relayPresence}
                    relayState={relayState}
                  />
                  <button
                    aria-label={t("runtimeSettingsTitle")}
                    className="headerSettingsButton"
                    type="button"
                    onClick={() => setIsRuntimeSettingsOpen(true)}
                  >
                    <Settings size={18} />
                  </button>
                </>
              }
              subtitle={headerRuntimeValues.join(" · ")}
              title={activeSession?.title ?? t("chat")}
            />
            <ChatPage
              approvals={approvals}
              composer={composer}
              composerCompletion={composerCompletion}
              desktopStatus={visibleDesktopStatus(desktopStatus)}
              hiddenMessageCount={hiddenMessageCount}
              isSessionLoading={isSessionLoading}
              isWorking={isWorking}
              messages={visibleMessages}
              messagesRef={messageListRef}
              onAddImages={addImageAttachments}
              onCloseComposerCompletion={closeComposerCompletion}
              onComposerChange={handleComposerChange}
              onLoadOlderMessages={loadOlderMessages}
              onMoveComposerCompletionSelection={moveComposerCompletionSelection}
              onOpenComposerCompletion={openComposerCompletion}
              onResolveApproval={resolveApproval}
              onRemoveAttachment={removePendingAttachment}
              onSelectComposerCompletion={selectComposerCompletion}
              onSend={sendMessage}
              onStop={interruptDesktop}
              pendingAttachments={pendingAttachments}
              turnDurationMs={visibleTurnDurationMs}
              t={t}
              attachmentInputRef={attachmentInputRef}
              session={activeSession}
            />
          </div>
        ) : null}
        {activeView === "settings" ? (
          <div className="pageFrame">
            <PageHeader title={t("settings")} subtitle={t("settingsSubtitle")} />
            <SettingsPage
              desktopDeviceId={desktopDeviceId}
              desktopDevices={desktopDevices}
              desktopDevicesError={desktopDevicesError}
              deviceId={deviceId}
              isDesktopDevicesLoading={isDesktopDevicesLoading}
              relayApiKey={relayApiKey}
	              relayEndpoint={relayEndpoint}
	              relayError={relayError}
	              relayPresence={relayPresence}
	              relayState={relayState}
              desktopName={device.name}
              model={model}
              modelOptions={modelOptions}
              modelEffort={modelEffort}
              notificationSoundEnabled={notificationSoundEnabled}
              notificationVibrationEnabled={notificationVibrationEnabled}
              permissionMode={permissionMode}
              rateLimitUsage={rateLimitUsage}
              systemNotificationsEnabled={systemNotificationsEnabled}
              themeMode={themeMode}
              language={language}
              t={t}
              onDesktopDeviceIdChange={updateDesktopDeviceId}
              onDesktopDevicesRefresh={() => setDesktopDevicesRefreshKey(key => key + 1)}
              onModelChange={updateModel}
              onModelEffortChange={updateModelEffort}
              onNotificationSoundEnabledChange={updateNotificationSoundEnabled}
              onNotificationVibrationEnabledChange={updateNotificationVibrationEnabled}
              onPermissionModeChange={updatePermissionMode}
              onLanguageChange={updateLanguage}
              onRelayApiKeyChange={updateRelayApiKey}
              onRelayEndpointChange={updateRelayEndpoint}
              onSystemNotificationsEnabledChange={updateSystemNotificationsEnabled}
              onThemeModeChange={updateThemeMode}
            />
          </div>
        ) : null}
      </section>

      <BottomNav
        activeView={activeView}
        hasUnreadSessions={hasUnreadSessions}
        onChange={setActiveView}
        t={t}
      />
    </main>
  );
}

function PageHeader({
  action,
  subtitle,
  title
}: {
  action?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <header className="pageHeader">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action ? <div className="pageHeaderAction">{action}</div> : null}
    </header>
  );
}

function HeaderConnectionStatus({
  language,
  relayError,
  relayPresence,
  relayState
}: {
  language: UILanguage;
  relayError: string;
  relayPresence: RelayPresence | null;
  relayState: RelayConnectionState;
}) {
  const relayConnected = relayState === "connected";
  const desktopConnected = Boolean(relayPresence?.desktopCount);
  const relayLabel = relayError
    ? `${relayStateLabel(relayState, language)}: ${relayError}`
    : relayStateLabel(relayState, language);
  const desktopLabel = desktopPresenceLabel(relayPresence, language);

  return (
    <div className="headerConnectionStatus" role="status">
      <span
        aria-label={relayLabel}
        className="headerConnectionIcon"
        data-connected={relayConnected}
        title={relayLabel}
      >
        <Globe size={14} strokeWidth={2.2} />
      </span>
      <span
        aria-label={desktopLabel}
        className="headerConnectionIcon"
        data-connected={desktopConnected}
        title={desktopLabel}
      >
        <Laptop size={14} strokeWidth={2.2} />
      </span>
    </div>
  );
}

function WorkspacePathModal({
  onClose,
  onOpen,
  onPathChange,
  path,
  t
}: {
  onClose: () => void;
  onOpen: (path: string) => void;
  onPathChange: (path: string) => void;
  path: string;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
}) {
  const canOpen = path.trim().length > 0;

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
        aria-labelledby="workspace-path-title"
        aria-modal="true"
        className="runtimeSettingsModal"
        role="dialog"
      >
        <header className="runtimeSettingsHeader">
          <div>
            <h2 id="workspace-path-title">{t("openWorkspaceTitle")}</h2>
            <p>{t("openWorkspaceHelp")}</p>
          </div>
          <button
            aria-label={t("closeWorkspaceDialog")}
            className="miniIconButton"
            type="button"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <form
          className="workspacePathForm"
          onSubmit={event => {
            event.preventDefault();
            onOpen(path);
          }}
        >
          <label className="settingsField">
            <span>{t("workspacePath")}</span>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              inputMode="url"
              placeholder={t("workspacePathPlaceholder")}
              value={path}
              onChange={event => onPathChange(event.target.value)}
            />
          </label>
          <div className="approvalActions">
            <button className="secondaryButton" type="button" onClick={onClose}>
              <X size={15} />
              {t("cancelRename")}
            </button>
            <button className="primaryButton" disabled={!canOpen} type="submit">
              <FolderOpen size={15} />
              {t("addWorkspace")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SessionsPage({
  activeSessionId,
  activeWorkspace,
  collapsedWorkspaces,
  favoriteSessionIds,
  onOpenSession,
  onOpenWorkspace,
  onSessionIconChange,
  onRenameSession,
  onStartSession,
  onTabChange,
  onToggleFavorite,
  onToggleWorkspace,
  sessionTab,
  t,
  workspaces
}: {
  activeSessionId: string | null;
  activeWorkspace: string | null;
  collapsedWorkspaces: Set<string>;
  favoriteSessionIds: Set<string>;
  onOpenSession: (sessionId: string) => void;
  onOpenWorkspace: (workspace: string) => void;
  onSessionIconChange: (sessionId: string, iconId: SessionIconId) => void;
  onRenameSession: (workspace: string, session: Session, title: string) => void;
  onStartSession: (workspace: string) => void;
  onTabChange: (tab: SessionTab) => void;
  onToggleFavorite: (sessionId: string) => void;
  onToggleWorkspace: (workspace: string) => void;
  sessionTab: SessionTab;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
  workspaces: Workspace[];
}) {
  const workspaceSessions = workspaces.flatMap(workspace =>
    workspace.sessions.map(session => ({ workspace, session }))
  );
  const recentSessions = [...workspaceSessions].sort(
    (left, right) => sessionSortValue(right.session) - sessionSortValue(left.session)
  );
  const favoriteSessions = workspaces.flatMap(workspace =>
    workspace.sessions
      .filter(session => isSessionFavorite(session, favoriteSessionIds))
      .map(session => ({ workspace, session }))
  );

  return (
    <div className="pageStack">
      <section className="sectionBlock" aria-labelledby="session-browser-title">
        <div className="sessionsStickyHeader">
          <div className="sectionHeader">
            <h2 id="session-browser-title">{t("sessionBrowser")}</h2>
            <span>{workspaces.length}</span>
          </div>
          <div className="sessionTabs" role="tablist" aria-label={t("sessionViews")}>
            <button
              aria-selected={sessionTab === "all"}
              className="sessionTab"
              role="tab"
              type="button"
              onClick={() => onTabChange("all")}
            >
              {t("all")}
            </button>
            <button
              aria-selected={sessionTab === "recent"}
              className="sessionTab"
              role="tab"
              type="button"
              onClick={() => onTabChange("recent")}
            >
              {t("recent")}
            </button>
            <button
              aria-selected={sessionTab === "favorites"}
              className="sessionTab"
              role="tab"
              type="button"
              onClick={() => onTabChange("favorites")}
            >
              {t("favorites")}
            </button>
          </div>
        </div>

        <div className="workspaceTree">
          {sessionTab === "all" ? (
            workspaces.length > 0 ? (
              workspaces.map(workspace => {
                const isCollapsed = collapsedWorkspaces.has(workspace.path);
                return (
                  <section
                    className="workspaceGroup"
                    data-active={workspace.path === activeWorkspace}
                    key={workspace.path}
                  >
                    <div className="workspaceRow">
                      <button
                        aria-expanded={!isCollapsed}
                        aria-label={
                          isCollapsed
                            ? t("expandWorkspace", { name: workspace.name })
                            : t("collapseWorkspace", { name: workspace.name })
                        }
                        className="miniIconButton"
                        type="button"
                        onClick={() => onToggleWorkspace(workspace.path)}
                      >
                        <ChevronRight
                          className={isCollapsed ? "" : "disclosureOpen"}
                          size={16}
                        />
                      </button>
                      <button
                        aria-label={t("openWorkspace", { name: workspace.name })}
                        className="workspaceOpenButton"
                        type="button"
                        onClick={() => onOpenWorkspace(workspace.path)}
                      >
                        <FolderOpen size={17} />
                        <div>
                          <strong>{workspace.name}</strong>
                          <small>{workspace.path}</small>
                        </div>
                      </button>
                      <button
                        aria-label={t("newSessionIn", { name: workspace.name })}
                        className="miniIconButton"
                        type="button"
                        onClick={() => onStartSession(workspace.path)}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    {!isCollapsed ? (
                      <div className="sessionList">
                        {workspace.sessions.length > 0 ? (
                          workspace.sessions.map(session => (
                            <MobileSessionRow
                              active={session.id === activeSessionId}
                              favorite={isSessionFavorite(session, favoriteSessionIds)}
                              key={session.id}
                              onFavorite={() => onToggleFavorite(session.id)}
                              onIconChange={iconId => onSessionIconChange(session.id, iconId)}
                              onOpen={() => onOpenSession(session.id)}
                              onRename={title => onRenameSession(workspace.path, session, title)}
                              session={session}
                              t={t}
                            />
                          ))
                        ) : (
                          <p className="emptyText">{t("noWorkspaceSessions")}</p>
                        )}
                      </div>
                    ) : null}
                  </section>
                );
              })
            ) : (
              <p className="emptyText">{t("noWorkspaces")}</p>
            )
          ) : sessionTab === "recent" ? (
            recentSessions.length > 0 ? (
              recentSessions.map(({ workspace, session }) => (
                <MobileSessionRow
                  active={session.id === activeSessionId}
                  favorite={isSessionFavorite(session, favoriteSessionIds)}
                  key={session.id}
                  meta={`${workspace.name} · ${session.updatedAt}`}
                  onFavorite={() => onToggleFavorite(session.id)}
                  onIconChange={iconId => onSessionIconChange(session.id, iconId)}
                  onOpen={() => onOpenSession(session.id)}
                  onRename={title => onRenameSession(workspace.path, session, title)}
                  session={session}
                  t={t}
                />
              ))
            ) : (
              <p className="emptyText">{t("recentEmpty")}</p>
            )
          ) : favoriteSessions.length > 0 ? (
            favoriteSessions.map(({ workspace, session }) => (
              <MobileSessionRow
                active={session.id === activeSessionId}
                favorite
                key={session.id}
                meta={`${workspace.name} · ${session.updatedAt}`}
                onFavorite={() => onToggleFavorite(session.id)}
                onIconChange={iconId => onSessionIconChange(session.id, iconId)}
                onOpen={() => onOpenSession(session.id)}
                onRename={title => onRenameSession(workspace.path, session, title)}
                session={session}
                t={t}
              />
            ))
          ) : (
            <p className="emptyText">{t("favoriteEmpty")}</p>
          )}
        </div>
      </section>
    </div>
  );
}

function MobileSessionRow({
  active,
  favorite,
  meta,
  onFavorite,
  onIconChange,
  onOpen,
  onRename,
  session,
  t
}: {
  active: boolean;
  favorite: boolean;
  meta?: string;
  onFavorite: () => void;
  onIconChange: (iconId: SessionIconId) => void;
  onOpen: () => void;
  onRename: (title: string) => void | Promise<void>;
  session: Session;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);

  useEffect(() => {
    if (!isRenaming) {
      setDraftTitle(session.title);
    }
  }, [isRenaming, session.title]);

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = draftTitle.trim();
    if (nextTitle && nextTitle !== session.title) {
      void onRename(nextTitle);
    }
    setIsRenaming(false);
  }

  function cancelRename() {
    setDraftTitle(session.title);
    setIsRenaming(false);
  }

  return (
    <div className="sessionRow" data-active={active} data-renaming={isRenaming}>
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
          <button aria-label={t("saveSessionName")} className="miniIconButton" type="submit">
            <Check size={16} />
          </button>
          <button
            aria-label={t("cancelRename")}
            className="miniIconButton"
            type="button"
            onClick={cancelRename}
          >
            <X size={16} />
          </button>
        </form>
      ) : (
        <>
          <div className="sessionIconPickerRoot">
            <button
              aria-expanded={isIconPickerOpen}
              aria-label={t("changeIconFor", { name: session.title })}
              className="sessionIconButton"
              data-working={session.status === "working"}
              type="button"
              style={sessionIconStyle(sessionIconFor(session.id, session.iconId))}
              onClick={() => setIsIconPickerOpen(previous => !previous)}
            >
              {session.unread ? <span className="unreadDot" aria-label={t("unreadTurn")} /> : null}
              <SessionIcon iconId={sessionIconFor(session.id, session.iconId)} />
            </button>
            {isIconPickerOpen ? (
              <div className="sessionIconPopover" role="dialog" aria-label={t("iconPicker")}>
                <div className="sessionIconPopoverHeader">
                  <strong>{t("iconPicker")}</strong>
                  <button
                    aria-label={t("closeIconPicker")}
                    className="miniIconButton"
                    type="button"
                    onClick={() => setIsIconPickerOpen(false)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="sessionIconGrid">
                  {SESSION_ICON_IDS.map(iconId => (
                    <button
                      aria-label={iconId}
                      className="sessionIconChoice"
                      data-active={sessionIconFor(session.id, session.iconId) === iconId}
                      key={iconId}
                      style={sessionIconStyle(iconId)}
                      type="button"
                      onClick={() => {
                        onIconChange(iconId);
                        setIsIconPickerOpen(false);
                      }}
                    >
                      <SessionIcon iconId={iconId} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <button className="sessionOpenButton" type="button" onClick={onOpen}>
            <div>
              <span>{session.title}</span>
              <small>
                {meta ?? `${session.id} · ${session.updatedAt}`}
                {session.status === "working" && session.turnStartedAt
                  ? ` · ${formatTurnDuration(Date.now() - session.turnStartedAt)}`
                  : session.lastTurnDurationMs
                    ? ` · ${formatTurnDuration(session.lastTurnDurationMs)}`
                    : ""}
              </small>
            </div>
            {session.status !== "ready" ? <SessionStatus status={session.status} t={t} /> : null}
          </button>
          <button
            aria-label={
              favorite
                ? t("unfavoriteSession", { name: session.title })
                : t("favoriteSession", { name: session.title })
            }
            className="miniIconButton"
            data-active={favorite}
            type="button"
            onClick={onFavorite}
          >
            <Star fill={favorite ? "currentColor" : "none"} size={16} />
          </button>
          <button
            aria-label={t("renameSession", { name: session.title })}
            className="miniIconButton"
            type="button"
            onClick={() => setIsRenaming(true)}
          >
            <Pencil size={16} />
          </button>
        </>
      )}
    </div>
  );
}

function ChatPage({
  approvals,
  attachmentInputRef,
  composer,
  composerCompletion,
  desktopStatus,
  hiddenMessageCount,
  isSessionLoading,
  isWorking,
  messages,
  messagesRef,
  onAddImages,
  onCloseComposerCompletion,
  onComposerChange,
  onLoadOlderMessages,
  onMoveComposerCompletionSelection,
  onOpenComposerCompletion,
  onRemoveAttachment,
  onResolveApproval,
  onSelectComposerCompletion,
  onSend,
  onStop,
  pendingAttachments,
  turnDurationMs,
  t,
  session
}: {
  approvals: Approval[];
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  composer: string;
  composerCompletion: ComposerCompletion | null;
  desktopStatus: string;
  hiddenMessageCount: number;
  isSessionLoading: boolean;
  isWorking: boolean;
  messages: Message[];
  messagesRef: RefObject<HTMLDivElement | null>;
  onAddImages: (files: FileList | File[]) => Promise<void>;
  onCloseComposerCompletion: () => void;
  onComposerChange: (value: string, cursor: number) => void;
  onLoadOlderMessages: () => void;
  onMoveComposerCompletionSelection: (direction: 1 | -1) => void;
  onOpenComposerCompletion: (mode: ComposerCompletionMode, cursor: number) => void;
  onRemoveAttachment: (id: string) => void;
  onResolveApproval: (approvalId: string, decision: "accept" | "decline") => void;
  onSelectComposerCompletion: (item: ComposerSuggestion) => void;
  onSend: () => void;
  onStop: () => void;
  pendingAttachments: PendingComposerAttachment[];
  turnDurationMs: number | null;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
  session?: Session;
}) {
  const composerDisabled = !session || isSessionLoading;
  const canSend =
    !composerDisabled && (composer.trim().length > 0 || pendingAttachments.length > 0);
  const showComposerStatus = !isWorking && !session && desktopStatus;
  const showWorkingStatus = isWorking && Boolean(session);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) {
      return;
    }

    input.style.height = "auto";
    const maxHeight = Number.parseFloat(window.getComputedStyle(input).maxHeight);
    const nextHeight = Number.isFinite(maxHeight)
      ? Math.min(input.scrollHeight, maxHeight)
      : input.scrollHeight;
    input.style.height = `${nextHeight}px`;
    input.style.overflowY =
      Number.isFinite(maxHeight) && input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [composer]);

  return (
    <div className="chatLayout">
      <div
        className="messageList"
        role="log"
        aria-label={t("chatMessages")}
        ref={messagesRef}
      >
        {hiddenMessageCount > 0 ? (
          <div className="historyLoader">
            <button type="button" onClick={onLoadOlderMessages}>
              {t("loadOlderMessages", {
                count: Math.min(MESSAGE_PAGE_SIZE, hiddenMessageCount)
              })}
            </button>
            <span>{t("hiddenMessages", { count: hiddenMessageCount })}</span>
          </div>
        ) : null}
        {isSessionLoading ? (
          <article className="messageItem" data-role="event">
            <div className="messageBubble">
              <small>{t("loading")}</small>
              <p>{t("resumingSession")}</p>
            </div>
          </article>
        ) : null}
        {approvals.length > 0 ? (
          <section className="chatApprovals" aria-labelledby="chat-approvals-title">
            <div className="sectionHeader">
              <h2 id="chat-approvals-title">{t("pendingApprovals")}</h2>
              <span>{approvals.length}</span>
            </div>
            <div className="approvalList compact">
              {approvals.map(approval => (
                <ApprovalCard
                  approval={approval}
                  key={approval.id}
                  onResolve={onResolveApproval}
                  t={t}
                />
              ))}
            </div>
          </section>
        ) : null}
        {messages.map(message => (
          <article className="messageItem" data-role={message.role} key={message.id}>
            <div className="messageBubble">
              {message.meta ? <small>{message.meta}</small> : null}
              <MarkdownContent text={message.text} />
              {message.attachments && message.attachments.length > 0 ? (
                <ImageAttachmentGrid attachments={message.attachments} t={t} />
              ) : null}
            </div>
          </article>
        ))}
      </div>

      <div className="composerDock">
        {showWorkingStatus ? (
          <WorkingTurnStatus
            session={session}
            t={t}
            turnDurationMs={turnDurationMs}
          />
        ) : null}
        {showComposerStatus ? (
          <div className="composerStatus" data-state="idle">
            <span className="statusDot" aria-hidden="true" />
            <small>{desktopStatus}</small>
          </div>
        ) : null}

        <form
          className="composer"
          onSubmit={event => {
            event.preventDefault();
            onSend();
          }}
        >
          {composerCompletion ? (
            <ComposerCompletionMenu
              completion={composerCompletion}
              onSelect={onSelectComposerCompletion}
              t={t}
            />
          ) : null}
          <input
            accept="image/*"
            aria-label={t("imageAttachments")}
            className="hiddenFileInput"
            multiple
            ref={attachmentInputRef}
            type="file"
            onChange={event => {
              const files = event.target.files;
              if (files) {
                void onAddImages(files);
              }
              event.currentTarget.value = "";
            }}
          />
          <div className="composerMain">
            {pendingAttachments.length > 0 ? (
              <div className="attachmentStrip" aria-label={t("selectedImages")}>
                {pendingAttachments.map(attachment => (
                  <div className="attachmentPreview" key={attachment.id}>
                    {attachment.kind === "image" ? (
                      <img alt="" src={attachment.dataUrl} />
                    ) : (
                      <span className="attachmentFileIcon" aria-hidden="true">
                        <FileText size={15} />
                      </span>
                    )}
                    <span>{attachment.name}</span>
                    <button
                      aria-label={t("removeAttachment", { name: attachment.name })}
                      type="button"
                      onClick={() => onRemoveAttachment(attachment.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              aria-label={t("messageCodex")}
              disabled={composerDisabled}
              ref={composerInputRef}
              onChange={event =>
                onComposerChange(event.target.value, event.target.selectionStart)
              }
              onKeyDown={event => {
                if (composerCompletion) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    onMoveComposerCompletionSelection(
                      event.key === "ArrowDown" ? 1 : -1
                    );
                    return;
                  }
                  if (
                    (event.key === "Enter" || event.key === "Tab") &&
                    composerCompletion.items[composerCompletion.selectedIndex]
                  ) {
                    event.preventDefault();
                    onSelectComposerCompletion(
                      composerCompletion.items[composerCompletion.selectedIndex]
                    );
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onCloseComposerCompletion();
                    return;
                  }
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              onSelect={event =>
                onComposerChange(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart
                )
              }
              placeholder={t("composerPlaceholder")}
              rows={1}
              value={composer}
            />
            <div className="composerToolbar" aria-label={t("runtimeSettings")}>
              <div className="composerTools">
                <button
                  aria-label={t("addImages")}
                  className="composerIconButton"
                  disabled={composerDisabled}
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  <Plus size={17} />
                </button>
                <span className="composerDivider" aria-hidden="true" />
                <button
                  aria-label={t("fileMention")}
                  className="composerTextButton"
                  disabled={composerDisabled}
                  type="button"
                  onClick={() => {
                    const cursor = composerInputRef.current?.selectionStart ?? composer.length;
                    onOpenComposerCompletion("file", cursor);
                    window.requestAnimationFrame(() => composerInputRef.current?.focus());
                  }}
                >
                  <AtSign size={16} />
                  <span>{t("files")}</span>
                </button>
                <button
                  aria-label={t("skills")}
                  className="composerTextButton"
                  disabled={composerDisabled}
                  type="button"
                  onClick={() => {
                    const cursor = composerInputRef.current?.selectionStart ?? composer.length;
                    onOpenComposerCompletion("skill", cursor);
                    window.requestAnimationFrame(() => composerInputRef.current?.focus());
                  }}
                >
                  <span className="composerDollarIcon" aria-hidden="true">
                    $
                  </span>
                  <span>{t("skills")}</span>
                </button>
              </div>
              {isWorking && !canSend ? (
                <button
                  aria-label={t("stopCurrentTurn")}
                  className="sendButton"
                  data-mode="stop"
                  onClick={onStop}
                  type="button"
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  aria-label={t("sendMessage")}
                  className="sendButton"
                  disabled={!canSend}
                  type="submit"
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function WorkingTurnStatus({
  session,
  t,
  turnDurationMs
}: {
  session?: Session;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
  turnDurationMs: number | null;
}) {
  const turnLabel =
    session?.activeTurnId?.slice(0, 8) ??
    session?.id.slice(0, 8) ??
    "";

  return (
    <div className="workingTurnStatus" role="status">
      <span className="workingTurnDot" aria-hidden="true" />
      <strong>{t("working")}</strong>
      {turnDurationMs !== null ? (
        <span className="workingTurnDuration">
          {formatTurnDuration(turnDurationMs)}
        </span>
      ) : null}
      <span className="workingTurnActivity" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {turnLabel ? <code>{turnLabel}</code> : null}
    </div>
  );
}

function ComposerCompletionMenu({
  completion,
  onSelect,
  t
}: {
  completion: ComposerCompletion;
  onSelect: (item: ComposerSuggestion) => void;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
}) {
  const emptyText =
    completion.mode === "file" ? t("noMatchingFiles") : t("noMatchingSkills");

  return (
    <div className="composerCompletionMenu" role="listbox">
      {completion.items.length > 0 ? (
        completion.items.map((item, index) => (
          <button
            aria-selected={index === completion.selectedIndex}
            className="composerCompletionItem"
            key={item.id}
            role="option"
            type="button"
            onClick={() => onSelect(item)}
          >
            <span className="composerCompletionIcon" aria-hidden="true">
              {item.type === "file" ? <FileText size={15} /> : "$"}
            </span>
            <span>
              <strong>{item.label}</strong>
              {item.detail ? <small>{item.detail}</small> : null}
            </span>
          </button>
        ))
      ) : (
        <div className="composerCompletionEmpty" role="status">
          {completion.loading ? t("loading") : emptyText}
        </div>
      )}
    </div>
  );
}

function ImageAttachmentGrid({
  attachments,
  t
}: {
  attachments: MessageAttachment[];
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="messageAttachmentGrid" aria-label={t("selectedImages")}>
      {attachments.map(attachment => (
        <figure key={attachment.id}>
          <img alt={attachment.name} src={attachment.dataUrl} />
          <figcaption>{attachment.name}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="markdownContent">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const markdownComponents: Components = {
  code(props) {
    const { children, className, ...rest } = props;
    const text = String(children ?? "");
    if (className?.includes("language-diff")) {
      return <code {...rest}>{renderDiffLines(text)}</code>;
    }
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
};

function renderDiffLines(text: string): ReactNode[] {
  return text.split("\n").map((line, index) => (
    <span className="diffLine" data-kind={diffLineKind(line)} key={`${index}-${line}`}>
      {line || " "}
    </span>
  ));
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
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  ) {
    return "meta";
  }
  return "context";
}

function RuntimeSettingsModal({
  language,
  model,
  modelEffort,
  modelOptions,
  onClose,
  onModelChange,
  onModelEffortChange,
  onPermissionModeChange,
  permissionMode,
  t
}: {
  language: UILanguage;
  model: string;
  modelEffort: ModelEffort;
  modelOptions: ModelOption[];
  onClose: () => void;
  onModelChange: (value: string) => void;
  onModelEffortChange: (value: ModelEffort) => void;
  onPermissionModeChange: (value: PermissionMode) => void;
  permissionMode: PermissionMode;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
}) {
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
        aria-labelledby="runtime-settings-title"
        aria-modal="true"
        className="runtimeSettingsModal"
        role="dialog"
      >
        <header className="runtimeSettingsHeader">
          <h2 id="runtime-settings-title">{t("runtimeSettingsTitle")}</h2>
          <button
            aria-label={t("closeRuntimeSettings")}
            className="miniIconButton"
            type="button"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <label className="settingsField">
          <span>{t("model")}</span>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            list="runtime-model-options"
            value={model}
            onChange={event => onModelChange(event.target.value)}
          />
          <datalist id="runtime-model-options">
            {modelOptions.map(option => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </datalist>
        </label>

        <label className="settingsField">
          <span>{t("reasoningLevel")}</span>
          <select
            value={modelEffort}
            onChange={event => onModelEffortChange(event.target.value as ModelEffort)}
          >
            {EFFORT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {effortLabel(option.value, language)}
              </option>
            ))}
          </select>
        </label>

        <label className="settingsField">
          <span>{t("permissions")}</span>
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
      </section>
    </div>
  );
}

function SettingsPage({
  desktopDeviceId,
  desktopDevices,
  desktopDevicesError,
  deviceId,
  isDesktopDevicesLoading,
  language,
  model,
  modelOptions,
  modelEffort,
  notificationSoundEnabled,
  notificationVibrationEnabled,
  permissionMode,
  rateLimitUsage,
  relayApiKey,
  relayEndpoint,
  relayError,
  relayPresence,
  relayState,
  desktopName,
  systemNotificationsEnabled,
  t,
  themeMode,
  onDesktopDeviceIdChange,
  onDesktopDevicesRefresh,
  onLanguageChange,
  onModelChange,
  onModelEffortChange,
  onNotificationSoundEnabledChange,
  onNotificationVibrationEnabledChange,
  onPermissionModeChange,
  onRelayApiKeyChange,
  onRelayEndpointChange,
  onSystemNotificationsEnabledChange,
  onThemeModeChange
}: {
  desktopDeviceId: string;
  desktopDevices: RelayDesktopDevice[];
  desktopDevicesError: string;
  deviceId: string;
  isDesktopDevicesLoading: boolean;
  language: UILanguage;
  model: string;
  modelOptions: ModelOption[];
  modelEffort: ModelEffort;
  notificationSoundEnabled: boolean;
  notificationVibrationEnabled: boolean;
  permissionMode: PermissionMode;
  rateLimitUsage: RateLimitUsage | null;
  relayApiKey: string;
  relayEndpoint: string;
  relayError: string;
  relayPresence: RelayPresence | null;
  relayState: RelayConnectionState;
  desktopName: string;
  systemNotificationsEnabled: boolean;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
  themeMode: ThemeMode;
  onDesktopDeviceIdChange: (value: string) => void;
  onDesktopDevicesRefresh: () => void;
  onLanguageChange: (value: UILanguage) => void;
  onModelChange: (value: string) => void;
  onModelEffortChange: (value: ModelEffort) => void;
  onNotificationSoundEnabledChange: (value: boolean) => void;
  onNotificationVibrationEnabledChange: (value: boolean) => void;
  onPermissionModeChange: (value: PermissionMode) => void;
  onRelayApiKeyChange: (value: string) => void;
  onRelayEndpointChange: (value: string) => void;
  onSystemNotificationsEnabledChange: (value: boolean) => void;
  onThemeModeChange: (value: ThemeMode) => void;
}) {
  const [copiedField, setCopiedField] = useState<"apiKey" | "desktopDeviceId" | null>(
    null
  );

  async function copySettingValue(
    field: "apiKey" | "desktopDeviceId",
    value: string
  ) {
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
    <div className="pageStack">
      <section className="settingsHero">
        <div className="brandMark">C</div>
        <div>
          <h2>Codex+ Mobile</h2>
          <p>{t("mobileSubtitle")}</p>
        </div>
      </section>

      <section className="sectionBlock">
        <h2>{t("connection")}</h2>
        <div className="settingsForm">
          <label className="settingsField">
            <span>{t("relayEndpoint")}</span>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="url"
              onChange={event => onRelayEndpointChange(event.target.value)}
              placeholder="ws://server:8909"
              value={relayEndpoint}
            />
          </label>
          <label className="settingsField">
            <span>{t("desktopDeviceId")}</span>
            <div className="desktopDevicePicker">
              <select
                disabled={desktopDevices.length === 0}
                value={desktopDevices.some(device => device.deviceId === desktopDeviceId) ? desktopDeviceId : ""}
                onChange={event => onDesktopDeviceIdChange(event.target.value)}
              >
                {desktopDevices.length === 0 ? (
                  <option value="">
                    {isDesktopDevicesLoading
                      ? t("loadingDesktopDevices")
                      : t("noDesktopDevices")}
                  </option>
                ) : null}
                {desktopDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.deviceId} · {device.desktopCount} {t("desktop")} ·{" "}
                    {device.clientCount} {t("mobileClients")}
                  </option>
                ))}
              </select>
              <button
                aria-label={t("refreshDevices")}
                className="copyValueButton"
                type="button"
                onClick={onDesktopDevicesRefresh}
              >
                <RefreshCw size={14} />
                <span>{t("refreshDevices")}</span>
              </button>
            </div>
            <small>
              {desktopDeviceId ? `${t("desktopDeviceIdFallback")}: ${desktopDeviceId}` : desktopDevicesError || t("noDesktopDevices")}
            </small>
            {desktopDeviceId ? (
              <button
                aria-label={t("copyDesktopDeviceId")}
                className="copyValueButton inlineCopyButton"
                type="button"
                onClick={() => void copySettingValue("desktopDeviceId", desktopDeviceId)}
              >
                {copiedField === "desktopDeviceId" ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedField === "desktopDeviceId" ? t("copied") : t("copy")}</span>
              </button>
            ) : null}
          </label>
          <label className="settingsField">
            <span>{t("apiKey")}</span>
            <div className="settingsInputRow">
              <input
                autoCapitalize="none"
                autoCorrect="off"
                onChange={event => onRelayApiKeyChange(event.target.value)}
                placeholder="cp_..."
                type="password"
                value={relayApiKey}
              />
              <button
                aria-label={t("copyApiKey")}
                className="copyValueButton"
                disabled={!relayApiKey}
                type="button"
                onClick={() => void copySettingValue("apiKey", relayApiKey)}
              >
                {copiedField === "apiKey" ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedField === "apiKey" ? t("copied") : t("copy")}</span>
              </button>
            </div>
          </label>
          <p className="settingsHelp">{t("relayHelp")}</p>
          {relayError ? <p className="settingsError">{relayError}</p> : null}
        </div>
        <SettingsRow
          icon={<Wifi size={18} />}
          label={t("relayMode")}
          value={relayApiKey ? relayStateLabel(relayState, language) : t("missingKey")}
        />
        <SettingsRow
          icon={<Laptop size={18} />}
          label={t("desktop")}
          value={desktopName}
        />
        <SettingsRow
          icon={<CircleDot size={18} />}
          label={t("desktopConnection")}
          value={desktopPresenceLabel(relayPresence, language)}
        />
        <SettingsRow
          icon={<Smartphone size={18} />}
          label={t("device")}
          value={deviceId.slice(0, 18)}
        />
      </section>

      <section className="sectionBlock">
        <h2>{t("appearance")}</h2>
        <label className="settingsField">
          <span>{t("theme")}</span>
          <select
            value={themeMode}
            onChange={event => onThemeModeChange(event.target.value as ThemeMode)}
          >
            <option value="dark">{t("dark")}</option>
            <option value="light">{t("light")}</option>
          </select>
        </label>
        <label className="settingsField">
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
        <p className="settingsHelp">{t("appearanceHelp")}</p>
      </section>

      <section className="sectionBlock">
        <h2>{t("model")}</h2>
        <label className="settingsField">
          <span>{t("model")}</span>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            list="mobile-model-options"
            value={model}
            onChange={event => onModelChange(event.target.value)}
          />
          <datalist id="mobile-model-options">
            {modelOptions.map(option => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </datalist>
        </label>
        <label className="settingsField">
          <span>{t("reasoningLevel")}</span>
          <select
            value={modelEffort}
            onChange={event => onModelEffortChange(event.target.value as ModelEffort)}
          >
            {EFFORT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {effortLabel(option.value, language)}
              </option>
            ))}
          </select>
        </label>
        <p className="settingsHelp">{effortDescription(modelEffort, language)}</p>
        <SettingsRow
          icon={<Code2 size={18} />}
          label={t("activeModel")}
          value={`${model} ${effortLabel(modelEffort, language)}`}
        />
      </section>

      <section className="sectionBlock">
        <h2>{t("safety")}</h2>
        <div className="limitGrid" aria-label={t("usageLimits")}>
          <LimitRing label="5h" value={rateLimitUsage?.primary?.leftPercent ?? null} t={t} />
          <LimitRing label="7d" value={rateLimitUsage?.secondary?.leftPercent ?? null} t={t} />
        </div>
        <label className="settingsField">
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
        <p className="settingsHelp">{permissionDescription(permissionMode, language)}</p>
        <SettingsRow
          icon={<ShieldCheck size={18} />}
          label={t("permissions")}
          value={permissionLabel(permissionMode, language)}
        />
        <SettingsRow
          icon={<Lock size={18} />}
          label={t("workspaceBoundary")}
          value={t("enforced")}
        />
      </section>

      <section className="sectionBlock">
        <h2>{t("notifications")}</h2>
        <SettingsToggle
          checked={systemNotificationsEnabled}
          icon={<Bell size={18} />}
          label={t("systemNotifications")}
          onChange={onSystemNotificationsEnabledChange}
        />
        <SettingsToggle
          checked={notificationVibrationEnabled}
          disabled={!systemNotificationsEnabled}
          icon={<Smartphone size={18} />}
          label={t("notificationVibration")}
          onChange={onNotificationVibrationEnabledChange}
        />
        <SettingsToggle
          checked={notificationSoundEnabled}
          disabled={!systemNotificationsEnabled}
          icon={<Bell size={18} />}
          label={t("notificationSound")}
          onChange={onNotificationSoundEnabledChange}
        />
        <p className="settingsHelp">{t("notificationsHelp")}</p>
      </section>

      <section className="sectionBlock">
        <h2>{t("developer")}</h2>
        <SettingsRow
          icon={<Code2 size={18} />}
          label={t("androidShell")}
          value="Capacitor"
        />
        <SettingsRow
          icon={<Database size={18} />}
          label={t("dataSource")}
          value={t("relaySnapshot")}
        />
      </section>
    </div>
  );
}

function BottomNav({
  activeView,
  hasUnreadSessions,
  onChange,
  t
}: {
  activeView: ViewMode;
  hasUnreadSessions: boolean;
  onChange: (view: ViewMode) => void;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
}) {
  return (
    <nav className="bottomNav" aria-label={t("primary")}>
      <NavItem
        active={activeView === "sessions"}
        hasUnread={hasUnreadSessions}
        icon={<ListChecks size={20} />}
        label={t("sessions")}
        onClick={() => onChange("sessions")}
        unreadLabel={t("unreadTurn")}
      />
      <NavItem
        active={activeView === "chat"}
        icon={<MessageCircle size={20} />}
        label={t("chat")}
        onClick={() => onChange("chat")}
      />
      <NavItem
        active={activeView === "settings"}
        icon={<Settings size={20} />}
        label={t("settings")}
        onClick={() => onChange("settings")}
      />
    </nav>
  );
}

function NavItem({
  active,
  hasUnread = false,
  icon,
  label,
  onClick,
  unreadLabel
}: {
  active: boolean;
  hasUnread?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  unreadLabel?: string;
}) {
  return (
    <button
      aria-label={hasUnread && unreadLabel ? `${label}, ${unreadLabel}` : label}
      className="navItem"
      data-active={active}
      onClick={onClick}
      type="button"
    >
      <span className="navIconWrap">
        {icon}
        {hasUnread ? <span className="navUnreadDot" aria-hidden="true" /> : null}
      </span>
      <span>{label}</span>
    </button>
  );
}

function ApprovalCard({
  approval,
  onResolve,
  t
}: {
  approval: Approval;
  onResolve: (approvalId: string, decision: "accept" | "decline") => void;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
}) {
  return (
    <article className="approvalCard" data-risk={approval.risk}>
      <div>
        <small>{t("risk", { risk: approval.risk })}</small>
        <h3>{approval.title}</h3>
        <p>{approval.detail}</p>
      </div>
      <div className="approvalActions">
        <button
          className="secondaryButton"
          type="button"
          onClick={() => onResolve(approval.id, "decline")}
        >
          <X size={15} />
          {t("decline")}
        </button>
        <button
          className="primaryButton"
          type="button"
          onClick={() => onResolve(approval.id, "accept")}
        >
          <Check size={15} />
          {t("approve")}
        </button>
      </div>
    </article>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="metricTile">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="settingsRow">
      <div className="settingsIcon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingsToggle({
  checked,
  disabled = false,
  icon,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settingsToggle" data-disabled={disabled}>
      <span className="settingsIcon">{icon}</span>
      <span>{label}</span>
      <input
        checked={checked}
        disabled={disabled}
        type="checkbox"
        onChange={event => onChange(event.target.checked)}
      />
    </label>
  );
}

function LimitRing({
  label,
  value,
  t
}: {
  label: string;
  value: number | null;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
}) {
  const percent = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      className="limitRing"
      data-empty={value === null}
      style={{ "--limit-percent": `${percent}%` } as CSSProperties}
      title={
        value === null
          ? `${label}: ${t("notReported")}`
          : `${label}: ${Math.round(percent)}%`
      }
    >
      <span>{label}</span>
      <strong>{value === null ? "—" : `${Math.round(percent)}%`}</strong>
    </div>
  );
}

function SessionStatus({
  status,
  t
}: {
  status: Session["status"];
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
}) {
  return (
    <span className="sessionStatus" data-state={status}>
      {t(status)}
    </span>
  );
}

function SessionIcon({ iconId }: { iconId: SessionIconId }) {
  const size = 17;
  switch (iconId) {
    case "terminal":
      return <SquareTerminal size={size} />;
    case "code":
      return <Code2 size={size} />;
    case "branch":
      return <GitBranch size={size} />;
    case "bug":
      return <Bug size={size} />;
    case "rocket":
      return <Rocket size={size} />;
    case "database":
      return <Database size={size} />;
    case "globe":
      return <Globe size={size} />;
    case "palette":
      return <Palette size={size} />;
    case "shield":
      return <ShieldCheck size={size} />;
    case "test":
      return <TestTube2 size={size} />;
    case "doc":
      return <FileText size={size} />;
    case "spark":
      return <Zap size={size} />;
    case "compass":
      return <Compass size={size} />;
    case "cube":
      return <Box size={size} />;
    case "graph":
      return <CircleDot size={size} />;
    case "bolt":
      return <Zap size={size} />;
    case "key":
      return <KeyRound size={size} />;
    case "cloud":
      return <Cloud size={size} />;
    case "chip":
      return <Cpu size={size} />;
    case "package":
      return <Package size={size} />;
    case "workflow":
      return <Workflow size={size} />;
    case "search":
      return <Search size={size} />;
    case "wrench":
      return <Wrench size={size} />;
    case "flag":
      return <Flag size={size} />;
    case "book":
      return <BookOpen size={size} />;
    case "clock":
      return <Clock size={size} />;
    case "pin":
      return <Pin size={size} />;
    case "layers":
      return <Layers size={size} />;
    case "atom":
      return <Atom size={size} />;
    case "eye":
      return <Eye size={size} />;
    case "flame":
      return <Flame size={size} />;
    case "wave":
      return <Waves size={size} />;
    case "gem":
      return <Gem size={size} />;
    case "target":
      return <Target size={size} />;
    case "beaker":
      return <FlaskConical size={size} />;
    case "satellite":
      return <Satellite size={size} />;
    case "lock":
      return <Lock size={size} />;
    case "brush":
      return <Brush size={size} />;
    case "grid":
      return <Grid3X3 size={size} />;
    default:
      return <Bot size={size} />;
  }
}

function sessionIconFor(sessionId: string, override: string | undefined): SessionIconId {
  if (isSessionIconId(override)) {
    return override;
  }
  const seed = Array.from(sessionId).reduce((sum, character) => {
    return sum + character.charCodeAt(0);
  }, 0);
  return SESSION_ICON_IDS[seed % SESSION_ICON_IDS.length];
}

function isSessionIconId(value: unknown): value is SessionIconId {
  return typeof value === "string" && SESSION_ICON_IDS.includes(value as SessionIconId);
}

function sessionIconStyle(iconId: SessionIconId): CSSProperties {
  const index = SESSION_ICON_IDS.indexOf(iconId);
  const hue = (index * 47 + 16) % 360;
  return {
    "--session-icon-bg": `hsl(${hue} 68% 18%)`,
    "--session-icon-fg": `hsl(${hue} 95% 74%)`,
    "--session-icon-soft": `hsl(${hue} 60% 30%)`,
    "--session-icon-ring": `hsl(${(hue + 62) % 360} 85% 70%)`
  } as CSSProperties;
}

function workspaceForSession(
  workspaces: Workspace[],
  sessionId: string
): Workspace | null {
  return (
    workspaces.find(workspace =>
      workspace.sessions.some(session => session.id === sessionId)
    ) ?? null
  );
}

function workspaceName(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || path || "Workspace";
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

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function readSavedThemeMode(): ThemeMode {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" ? "light" : "dark";
}

function readSavedLanguage(): UILanguage {
  const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return saved === "en" ? "en" : "zh-CN";
}

function defaultMobileRelayEndpoint(): string {
  return CLOUD_RELAY_ENDPOINT;
}

function readSavedRelayEndpoint(): string {
  const saved = window.localStorage.getItem(RELAY_ENDPOINT_STORAGE_KEY);
  const endpoint = normalizedRelayEndpoint(
    !saved || isLegacyDefaultRelayEndpoint(saved) ? defaultMobileRelayEndpoint() : saved
  );
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

function normalizedRelayEndpoint(value: string): string {
  const trimmed = value.trim();
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;

  if (trimmed === "") {
    return defaultMobileRelayEndpoint();
  }

  if (/^wss?:\/\/:\d+$/i.test(trimmed)) {
    return trimmed.replace("://:", `://${host}:`);
  }

  if (/^:\d+$/.test(trimmed)) {
    return `${protocol}://${host}${trimmed}`;
  }

  if (/^\d+$/.test(trimmed)) {
    return `${protocol}://${host}:${trimmed}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http/i, "ws");
  }

  if (!/^wss?:\/\//i.test(trimmed)) {
    return `${protocol}://${trimmed}`;
  }

  return trimmed;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error(`Unable to read ${file.name || "image"} as data URL`));
      }
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error(`Unable to read ${file.name || "image"}`));
    });
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || inferredImageMimeType(file) !== null;
}

function imageMimeTypeForFile(file: File): string {
  if (file.type.startsWith("image/")) {
    return file.type;
  }
  return inferredImageMimeType(file) ?? "image/png";
}

function inferredImageMimeType(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return null;
  }
}

function normalizeImageDataUrl(dataUrl: string, mimeType: string): string {
  if (dataUrl.startsWith("data:image/")) {
    return dataUrl;
  }
  return dataUrl.replace(/^data:[^;]*;base64,/, `data:${mimeType};base64,`);
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "default" || value === "auto-review" || value === "full-access";
}

function isModelEffort(value: unknown): value is ModelEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function textFor(
  language: UILanguage,
  key: UIMessageKey,
  values?: Record<string, string | number>
): string {
  let text = String(UI_TEXT[language][key] ?? UI_TEXT.en[key]);
  if (values) {
    Object.entries(values).forEach(([name, value]) => {
      text = text.split(`{${name}}`).join(String(value));
    });
  }
  return text;
}

function permissionLabel(value: PermissionMode, language: UILanguage = "en"): string {
  const labels: Record<UILanguage, Record<PermissionMode, string>> = {
    en: {
      default: "Default",
      "auto-review": "Auto-review",
      "full-access": "Full Access"
    },
    "zh-CN": {
      default: "默认",
      "auto-review": "自动审查",
      "full-access": "Full Access"
    }
  };
  return labels[language][value] ?? value;
}

function permissionDescription(
  value: PermissionMode,
  language: UILanguage = "en"
): string {
  const descriptions: Record<UILanguage, Record<PermissionMode, string>> = {
    en: {
      default:
        "Read and edit this workspace, run commands, and ask before internet access or edits outside the workspace.",
      "auto-review":
        "Same as Default, but eligible approvals are routed through the auto-reviewer subagent.",
      "full-access":
        "Edit outside this workspace and access the internet without asking for approval."
    },
    "zh-CN": {
      default: "可读写当前工作区并运行命令；访问网络或修改工作区外文件前需要审批。",
      "auto-review": "与默认权限相同，但符合条件的审批会交给 auto-reviewer subagent。",
      "full-access": "可修改工作区外文件并访问网络，不再请求审批。"
    }
  };
  return descriptions[language][value] ?? textFor(language, "customApprovalPolicy");
}

function effortLabel(value: ModelEffort, language: UILanguage = "en"): string {
  const labels: Record<UILanguage, Record<ModelEffort, string>> = {
    en: {
      low: "Fast",
      medium: "Medium",
      high: "High",
      xhigh: "XHigh"
    },
    "zh-CN": {
      low: "快速",
      medium: "中等",
      high: "高",
      xhigh: "超高"
    }
  };
  return labels[language][value] ?? value;
}

function effortDescription(value: ModelEffort, language: UILanguage = "en"): string {
  const descriptions: Record<UILanguage, Record<ModelEffort, string>> = {
    en: {
      low: "Lowest reasoning latency.",
      medium: "Balanced speed and depth.",
      high: "Deeper reasoning for harder tasks.",
      xhigh: "Maximum reasoning depth."
    },
    "zh-CN": {
      low: "最低推理延迟。",
      medium: "平衡速度和深度。",
      high: "更深的推理，适合复杂任务。",
      xhigh: "最高推理深度。"
    }
  };
  return descriptions[language][value] ?? value;
}

function connectionLabel(value: ConnectionState, language: UILanguage): string {
  return textFor(language, value);
}

function relayStateLabel(value: RelayConnectionState, language: UILanguage): string {
  return textFor(language, value);
}

function desktopPresenceLabel(
  presence: RelayPresence | null,
  language: UILanguage
): string {
  return presence?.desktopCount ? textFor(language, "desktopOnline") : textFor(language, "desktopOffline");
}

function contextLabel(
  usage: { usedTokens: number; contextWindow: number | null } | null,
  language: UILanguage = "en"
): string {
  if (!usage) {
    return textFor(language, "contextUnknown");
  }
  if (usage.contextWindow && usage.contextWindow > 0) {
    const remaining = Math.max(usage.contextWindow - usage.usedTokens, 0);
    return textFor(language, "contextLeft", { count: formatTokenCount(remaining) });
  }
  return textFor(language, "contextUsed", { count: formatTokenCount(usage.usedTokens) });
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

function sessionSortValue(session: Session): number {
  const dateParts = session.updatedAt.split(" · ");
  const dateText = dateParts[dateParts.length - 1] ?? session.updatedAt;
  const value = Date.parse(dateText);
  return Number.isFinite(value) ? value : 0;
}

function isSessionFavorite(
  session: Session,
  favoriteSessionIds: Set<string>
): boolean {
  return session.favorite === true || favoriteSessionIds.has(session.id);
}

function isHiddenChatMessage(message: Message): boolean {
  if (message.role !== "event") {
    return false;
  }
  const meta = message.meta?.trim().toLowerCase() ?? "";
  const text = message.text.trim().toLowerCase().replace(/\.$/, "");
  return meta === "turn" && (text === "turn started" || text === "turn completed");
}

function visibleDesktopStatus(status: string): string {
  const normalized = status.trim().toLowerCase().replace(/\.$/, "");
  return normalized === "turn started" || normalized === "turn completed" ? "" : status;
}

function uniqueId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : Date.now().toString(36);
}

function storedDeviceId(): string {
  const existing = window.localStorage.getItem(RELAY_DEVICE_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const next = `mobile-${uniqueId()}`;
  window.localStorage.setItem(RELAY_DEVICE_ID_STORAGE_KEY, next);
  return next;
}

function initialViewMode(): ViewMode {
  const value = new URLSearchParams(window.location.search).get("view");
  return value === "sessions" || value === "settings" || value === "chat"
    ? value
    : "chat";
}

function relayWebSocketURL(
  endpoint: string,
  role: "desktop" | "client",
  deviceId: string,
  apiKey: string,
  clientDeviceId?: string
): string | null {
  let base = endpoint.trim().replace(/\/+$/, "");
  if (!base) {
    return null;
  }
  if (base.startsWith("https://")) {
    base = `wss://${base.slice("https://".length)}`;
  } else if (base.startsWith("http://")) {
    base = `ws://${base.slice("http://".length)}`;
  }
  const separator = base.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    device_id: deviceId,
    api_key: apiKey
  });
  if (role === "client" && clientDeviceId) {
    params.set("client_device_id", clientDeviceId);
  }
  const url = `${base}/ws/${role}${separator}${params.toString()}`;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

function relayDevicesURL(endpoint: string): string | null {
  const baseURL = relayHTTPBaseURL(endpoint);
  if (!baseURL) {
    return null;
  }
  baseURL.pathname = `${baseURL.pathname.replace(/\/+$/, "")}/api/auth/devices`;
  baseURL.search = "";
  baseURL.hash = "";
  return baseURL.toString();
}

function relayHTTPBaseURL(endpoint: string): URL | null {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function relayDesktopDevicesFromPayload(payload: unknown): RelayDesktopDevice[] {
  const devices = asRecord(payload).devices;
  if (!Array.isArray(devices)) {
    return [];
  }
  return devices
    .map(item => {
      const record = asRecord(item);
      const deviceId = stringFromUnknown(record.device_id);
      if (!deviceId) {
        return null;
      }
      return {
        deviceId,
        desktopCount: numberFromUnknown(record.desktop_count),
        clientCount: numberFromUnknown(record.client_count),
        connected: Boolean(record.connected),
        lastSeen: stringFromUnknown(record.last_seen)
      };
    })
    .filter((device): device is RelayDesktopDevice => Boolean(device))
    .filter(device => device.desktopCount > 0 || device.connected)
    .sort((left, right) => Number(right.connected) - Number(left.connected));
}

function relayPresenceFromPayload(payload: unknown): RelayPresence {
  const record = asRecord(payload);
  return {
    deviceId: stringFromUnknown(record.device_id),
    desktopCount: numberFromUnknown(record.desktop_count),
    clientCount: numberFromUnknown(record.client_count),
    connected: Boolean(record.connected),
    lastSeen: stringFromUnknown(record.last_seen)
  };
}

function errorMessageFromBody(body: unknown): string {
  const error = asRecord(body).error;
  return typeof error === "string" ? error : "";
}

function parseRelayEnvelope(data: unknown): RelayEnvelope | null {
  if (typeof data !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(data) as RelayEnvelope;
    return typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function clientCommandAckId(payload: unknown): string | null {
  const id = asRecord(payload).client_message_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function relayEventFromPayload(payload: unknown): RelayEventRecord | null {
  const event = asRecord(asRecord(payload).event);
  return normalizeRelayEvent(event);
}

function snapshotFromRelayEvent(event: RelayEventRecord): DesktopSnapshotPayload | null {
  const payload = asRecord(event.payload);
  const snapshot = asRecord(payload.snapshot);
  if (Object.keys(snapshot).length > 0) {
    return snapshot as DesktopSnapshotPayload;
  }
  return Object.keys(payload).length > 0 ? (payload as DesktopSnapshotPayload) : null;
}

function relayEventsFromBacklog(payload: unknown): RelayEventRecord[] {
  const events = asRecord(payload).events;
  if (!Array.isArray(events)) {
    return [];
  }
  return events
    .map(item => normalizeRelayEvent(asRecord(item)))
    .filter((event): event is RelayEventRecord => event !== null);
}

function normalizeRelayEvent(event: Record<string, unknown>): RelayEventRecord | null {
  const id = typeof event.id === "number" ? event.id : Number(event.id);
  const type = typeof event.type === "string" ? event.type : "";
  if (!Number.isFinite(id) || id <= 0 || !type) {
    return null;
  }
  return {
    id,
    type,
    workspace_id:
      typeof event.workspace_id === "string" ? event.workspace_id : undefined,
    session_id: typeof event.session_id === "string" ? event.session_id : undefined,
    title: typeof event.title === "string" ? event.title : undefined,
    body: typeof event.body === "string" ? event.body : undefined,
    payload: asRecord(event.payload),
    created_at: typeof event.created_at === "string" ? event.created_at : undefined
  };
}

function remoteMessageFromPayload(value: unknown): Message | null {
  const record = asRecord(value);
  const id = typeof record.id === "string" ? record.id : "";
  const role =
    record.role === "user" || record.role === "codex" || record.role === "event"
      ? record.role
      : null;
  const text = typeof record.text === "string" ? record.text : "";
  if (!id || !role || !text) {
    return null;
  }
  return {
    id,
    role,
    text,
    meta: typeof record.meta === "string" ? record.meta : undefined
  };
}

function composerSuggestionsFromPayload(value: unknown): ComposerSuggestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): ComposerSuggestion | null => {
      const record = asRecord(item);
      const type =
        record.type === "skill" ? "skill" : record.type === "file" ? "file" : null;
      const label = typeof record.label === "string" ? record.label : "";
      const insertText = typeof record.insertText === "string" ? record.insertText : "";
      if (!type || !label || !insertText) {
        return null;
      }
      const suggestion: ComposerSuggestion = {
        id:
          typeof record.id === "string" && record.id.length > 0
            ? record.id
            : `${type}-${label}`,
        type,
        label,
        name:
          typeof record.name === "string" && record.name.length > 0
            ? record.name
            : label,
        detail: typeof record.detail === "string" ? record.detail : undefined,
        insertText,
        path: typeof record.path === "string" ? record.path : undefined
      };
      return suggestion;
    })
    .filter((item): item is ComposerSuggestion => item !== null);
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

  return {
    mode: match[2] === "@" ? "file" : "skill",
    query: match[3],
    tokenStart: match.index + match[1].length
  };
}

function readLastRelayEventId(): number {
  const value = Number(window.localStorage.getItem(RELAY_LAST_EVENT_ID_STORAGE_KEY) ?? "0");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function readBooleanStorage(key: string, fallback: boolean): boolean {
  const value = window.localStorage.getItem(key);
  if (value === null) {
    return fallback;
  }
  return value === "true";
}

function writeBooleanStorage(key: string, value: boolean) {
  window.localStorage.setItem(key, String(value));
}

function readPendingRelayCommands(): Record<string, PendingRelayCommand> {
  try {
    const raw = window.localStorage.getItem(PENDING_RELAY_COMMANDS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const record = asRecord(parsed);
    return Object.fromEntries(
      Object.entries(record).filter((entry): entry is [string, PendingRelayCommand] => {
        const pending = asRecord(entry[1]);
        const message = asRecord(pending.message);
        return (
          typeof pending.id === "string" &&
          typeof pending.createdAt === "number" &&
          typeof message.type === "string"
        );
      })
    );
  } catch {
    return {};
  }
}

function writePendingRelayCommands(commands: Record<string, PendingRelayCommand>) {
  try {
    window.localStorage.setItem(
      PENDING_RELAY_COMMANDS_STORAGE_KEY,
      JSON.stringify(commands)
    );
  } catch {
    // Large image attachments can exceed localStorage; in-memory retry still applies.
  }
}

function rememberRelayEventId(currentEventId: number, id: number): number {
  const current = Math.max(currentEventId, readLastRelayEventId());
  const next = Math.max(current, id);
  window.localStorage.setItem(RELAY_LAST_EVENT_ID_STORAGE_KEY, String(next));
  return next;
}

async function notifyTurnCompleted(
  event: RelayEventRecord,
  settings: TurnCompleteNotificationSettings,
  appInForeground: boolean
) {
  try {
    if (!settings.enabled || event.type !== "turn.completed" || appInForeground) {
      return;
    }
    if (Capacitor.getPlatform() !== "android") {
      return;
    }

    const ready = await ensureTurnCompleteNotificationReady(settings);
    if (!ready) {
      return;
    }

    const channelId = turnCompleteNotificationChannelId(settings);
    const payload = asRecord(event.payload);
    const sessionTitle =
      typeof payload.session_title === "string" ? payload.session_title.trim() : "";
    const workspace =
      typeof payload.workspace === "string" ? workspaceName(payload.workspace) : "";
    const payloadNotificationBody =
      typeof payload.notification_body === "string" ? payload.notification_body : "";
    const payloadFinalMessage =
      typeof payload.final_message === "string" ? payload.final_message : "";
    const body =
      notificationBodyFromFinalMessage(payloadNotificationBody || payloadFinalMessage || event.body || "") ||
      (sessionTitle ? `${sessionTitle} completed.` : "A Codex turn completed.");
    const largeBody = workspace ? `${body}\nWorkspace: ${workspace}` : body;
    const title = notificationTitleForTurn(event.title, sessionTitle);

    await LocalNotifications.schedule({
      notifications: [
        {
          id: notificationIdFromEvent(event.id),
          title,
          body,
          largeBody,
          summaryText: workspace || "Codex+ Mobile",
          channelId,
          sound: settings.sound ? NOTIFICATION_SOUND_FILE : undefined,
          autoCancel: true,
          extra: {
            sessionId: event.session_id ?? "",
            workspaceId: event.workspace_id ?? "",
            eventId: event.id
          }
        }
      ]
    });
  } catch {
    // Notification delivery should never interrupt relay event handling.
  }
}

function notificationTitleForTurn(title: string | undefined, sessionTitle: string): string {
  const normalizedTitle = (title ?? "").trim();
  if (sessionTitle && (!normalizedTitle || normalizedTitle === "Turn completed")) {
    return sessionTitle;
  }
  return normalizedTitle || sessionTitle || "Codex+";
}

function notificationBodyFromFinalMessage(message: string): string {
  return truncateNotificationText(cleanNotificationText(message), NOTIFICATION_BODY_MAX_CHARS);
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

async function ensureTurnCompleteNotificationReady(
  settings: Pick<TurnCompleteNotificationSettings, "sound" | "vibration">
): Promise<boolean> {
  if (Capacitor.getPlatform() !== "android") {
    return false;
  }

  const currentPermission = await LocalNotifications.checkPermissions();
  const permission =
    currentPermission.display === "granted"
      ? currentPermission
      : await LocalNotifications.requestPermissions();
  if (permission.display !== "granted") {
    return false;
  }

  await cleanupTurnCompleteNotificationChannels(settings);
  await LocalNotifications.createChannel({
    id: turnCompleteNotificationChannelId(settings),
    name: "Codex turn completion",
    description: "Notifications shown when a Codex turn completes.",
    importance: settings.sound || settings.vibration ? 5 : 3,
    visibility: 1,
    sound: settings.sound ? NOTIFICATION_SOUND_FILE : undefined,
    vibration: settings.vibration,
    lights: true,
    lightColor: "#ff3b30"
  });
  return true;
}

async function cleanupTurnCompleteNotificationChannels(
  settings: Pick<TurnCompleteNotificationSettings, "sound" | "vibration">
) {
  if (Capacitor.getPlatform() !== "android") {
    return;
  }

  const currentChannelId = turnCompleteNotificationChannelId(settings);
  try {
    const { channels } = await LocalNotifications.listChannels();
    await Promise.all(
      channels
        .map(channel => channel.id)
        .filter(
          channelId =>
            channelId.startsWith(`${NOTIFICATION_CHANNEL_PREFIX}_`) &&
            channelId !== currentChannelId
        )
        .map(channelId => LocalNotifications.deleteChannel({ id: channelId }))
    );
  } catch {
    // Channel cleanup is best effort; notification delivery should still work.
  }
}

function turnCompleteNotificationChannelId(
  settings: Pick<TurnCompleteNotificationSettings, "sound" | "vibration">
): string {
  const sound = settings.sound ? "sound" : "silent";
  const vibration = settings.vibration ? "vibrate" : "still";
  return `${NOTIFICATION_CHANNEL_PREFIX}_${sound}_${vibration}_${NOTIFICATION_CHANNEL_VERSION}`;
}

function notificationIdFromEvent(id: number): number {
  const normalized = Math.trunc(Math.abs(id));
  return normalized > 0 && normalized <= 2147483647
    ? normalized
    : Math.floor(Date.now() % 2147483647);
}

function isAppForeground(): boolean {
  return document.visibilityState === "visible";
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberFromUnknown(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
