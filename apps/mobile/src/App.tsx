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
import { useEffect, useMemo, useRef, useState } from "react";
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

type RelayConnectionState = "disabled" | "connecting" | "connected" | "error";
type SessionTab = "all" | "favorites";
type ThemeMode = "dark" | "light";
type UILanguage = "en" | "zh-CN";

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
    favorites: "Favorites",
    noWorkspaceSessions: "No sessions in this workspace.",
    favoriteEmpty: "Star sessions to keep them in this view.",
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
    messageCodex: "Message Codex",
    composerPlaceholder: "Message Codex on your desktop",
    runtimeSettings: "Runtime settings",
    runtimeSettingsTitle: "Runtime settings",
    closeRuntimeSettings: "Close runtime settings",
    stopCurrentTurn: "Stop current turn",
    sendMessage: "Send message",
    sentImages: "Sent images",
    mobileSubtitle: "Browser-first remote control shell",
    settingsSubtitle: "Remote access and app preferences",
    connection: "Connection",
    relayEndpoint: "Relay endpoint",
    desktopDeviceId: "Desktop device ID",
    apiKey: "API key",
    relayHelp:
      "Use the same API key as the desktop app. The endpoint should point to the Go relay server. The desktop device ID must match the desktop Settings dialog.",
    relayMode: "Relay mode",
    missingKey: "Missing key",
    desktop: "Desktop",
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
    connecting: "Connecting",
    connected: "Connected",
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
    favorites: "收藏",
    noWorkspaceSessions: "这个工作区还没有会话。",
    favoriteEmpty: "收藏常用会话后，会显示在这里。",
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
    messageCodex: "给 Codex 发消息",
    composerPlaceholder: "在桌面端向 Codex 发消息",
    runtimeSettings: "运行设置",
    runtimeSettingsTitle: "运行设置",
    closeRuntimeSettings: "关闭运行设置",
    stopCurrentTurn: "停止当前 Turn",
    sendMessage: "发送消息",
    sentImages: "已发送图片",
    mobileSubtitle: "浏览器优先的远程控制界面",
    settingsSubtitle: "远程连接与应用偏好",
    connection: "连接",
    relayEndpoint: "Relay endpoint",
    desktopDeviceId: "桌面端 Device ID",
    apiKey: "API key",
    relayHelp:
      "使用与桌面端相同的 API key。Endpoint 指向 Go relay 服务，桌面端 Device ID 必须与桌面设置中的值一致。",
    relayMode: "Relay 模式",
    missingKey: "缺少 key",
    desktop: "桌面端",
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
    connecting: "连接中",
    connected: "已连接",
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
  payload?: DesktopSnapshotPayload;
}

interface PendingImageAttachment {
  id: string;
  kind: "image";
  name: string;
  mimeType: string;
  dataUrl: string;
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
  const [sessionTab, setSessionTab] = useState<SessionTab>(() =>
    readStringList(FAVORITE_SESSIONS_STORAGE_KEY).length > 0 ? "favorites" : "all"
  );
  const [favoriteSessionIds, setFavoriteSessionIds] = useState<Set<string>>(
    () => new Set(readStringList(FAVORITE_SESSIONS_STORAGE_KEY))
  );
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(
    () => new Set(readStringList(COLLAPSED_WORKSPACES_STORAGE_KEY))
  );
  const [composer, setComposer] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingImageAttachment[]>(
    []
  );
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
    () =>
      normalizedRelayEndpoint(
        window.localStorage.getItem(RELAY_ENDPOINT_STORAGE_KEY) ??
          defaultMobileRelayEndpoint()
      )
  );
  const [relayApiKey, setRelayApiKey] = useState(
    () => window.localStorage.getItem(RELAY_API_KEY_STORAGE_KEY) ?? ""
  );
  const [desktopDeviceId, setDesktopDeviceId] = useState(
    () => window.localStorage.getItem(RELAY_DESKTOP_DEVICE_ID_STORAGE_KEY) ?? "desktop-main"
  );
  const [relayState, setRelayState] = useState<RelayConnectionState>("disabled");
  const [relayError, setRelayError] = useState("");
  const [deviceId] = useState(() => storedDeviceId());
  const relaySocketRef = useRef<WebSocket | null>(null);
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
  const activeSession =
    visibleWorkspaces
      .flatMap(workspace => workspace.sessions)
      .find(session => session.id === activeSessionId) ??
    sessions.find(session => session.id === activeSessionId) ??
    sessions[0];
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
    if (!relayEndpoint.trim() || !relayApiKey.trim()) {
      relaySocketRef.current?.close();
      relaySocketRef.current = null;
      setRelayState("disabled");
      setRelayError("");
      return undefined;
    }

    const relayUrl = relayWebSocketURL(relayEndpoint, "client", desktopDeviceId, relayApiKey);
    if (!relayUrl) {
      relaySocketRef.current?.close();
      relaySocketRef.current = null;
      setRelayState("error");
      setRelayError(`Invalid relay endpoint: ${relayEndpoint}`);
      return undefined;
    }

    setRelayState("connecting");
    setRelayError("");
    const socket = new WebSocket(relayUrl);
    relaySocketRef.current = socket;

    socket.addEventListener("open", () => {
      setRelayState("connected");
      setRelayError("");
    });
    socket.addEventListener("message", event => {
      applyRelayMessage(event.data);
    });
    socket.addEventListener("close", () => {
      if (relaySocketRef.current === socket) {
        relaySocketRef.current = null;
        setRelayState("error");
        setRelayError(`Relay connection closed: ${relayUrl}`);
      }
    });
    socket.addEventListener("error", () => {
      setRelayState("error");
      setRelayError(`Relay connection failed: ${relayUrl}`);
    });

    return () => {
      if (relaySocketRef.current === socket) {
        relaySocketRef.current = null;
      }
      socket.close();
    };
  }, [desktopDeviceId, relayApiKey, relayEndpoint]);

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

    setMessages(previous => [
      ...previous,
      {
        id: `local-${Date.now()}`,
        role: "user",
        text: text.length > 0 ? text : t("sentImages"),
        attachments: outgoingAttachments.map(attachment => ({
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
    publishRelay({
      type: "client.send_message",
      payload: {
        text,
        attachments: outgoingAttachments.map(({ kind, name, mimeType, dataUrl }) => ({
          kind,
          name,
          mimeType,
          dataUrl
        }))
      }
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

  function interruptDesktop() {
    setIsWorking(false);
    publishRelay({ type: "client.interrupt" });
  }

  function openSession(sessionId: string) {
    const targetWorkspace = workspaceForSession(visibleWorkspaces, sessionId);
    setActiveSessionId(sessionId);
    setMessages([]);
    setIsSessionLoading(true);
    if (targetWorkspace) {
      setActiveWorkspace(targetWorkspace.path);
      publishRelay({
        type: "client.open_session",
        payload: { workspace: targetWorkspace.path, sessionId }
      });
    }
    setActiveView("chat");
  }

  function startSessionInWorkspace(workspace: string) {
    setActiveWorkspace(workspace);
    setMessages([]);
    setIsSessionLoading(true);
    publishRelay({
      type: "client.new_session",
      payload: { workspace }
    });
    setActiveView("chat");
  }

  function openWorkspace(workspace: string) {
    setActiveWorkspace(workspace);
    setActiveSessionId(null);
    setMessages([]);
    setApprovals([]);
    setIsSessionLoading(false);
    publishRelay({
      type: "client.open_workspace",
      payload: { workspace }
    });
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
    publishRelay({
      type: "client.rename_session",
      payload: { workspace, sessionId: session.id, title }
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
    publishRelay({
      type: "client.set_session_icon",
      payload: { sessionId, iconId }
    });
  }

  function toggleFavoriteSession(sessionId: string) {
    setFavoriteSessionIds(previous => {
      const next = new Set(previous);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      saveStringList(FAVORITE_SESSIONS_STORAGE_KEY, Array.from(next));
      return next;
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
    publishRelay({
      type: "client.resolve_approval",
      payload: { requestId: approvalId, decision }
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
    publishRelay({
      type: "client.set_permissions",
      payload: { permissionMode: value }
    });
  }

  function updateModel(value: string) {
    const nextModel = value.trim();
    if (!nextModel) {
      return;
    }
    setModel(nextModel);
    publishRelay({
      type: "client.set_model",
      payload: { model: nextModel, effort: modelEffort }
    });
  }

  function updateModelEffort(value: ModelEffort) {
    setModelEffort(value);
    publishRelay({
      type: "client.set_model",
      payload: { model, effort: value }
    });
  }

  function updateThemeMode(value: ThemeMode) {
    setThemeMode(value);
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  }

  function updateLanguage(value: UILanguage) {
    setLanguage(value);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  }

  function applyRelayMessage(data: unknown) {
    const envelope = parseRelayEnvelope(data);
    if (!envelope || envelope.type !== "desktop.snapshot" || !envelope.payload) {
      return;
    }
    const snapshot = envelope.payload;
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

  function publishRelay(message: { type: string; payload?: Record<string, unknown> }) {
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

      <section className="pageViewport" aria-live="polite">
        {activeView === "sessions" ? (
          <div className="pageFrame">
            <PageHeader title={t("sessions")} subtitle={t("sessionsSubtitle")} />
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
                <button
                  aria-label={t("runtimeSettingsTitle")}
                  className="headerSettingsButton"
                  type="button"
                  onClick={() => setIsRuntimeSettingsOpen(true)}
                >
                  <Settings size={18} />
                </button>
              }
              subtitle={headerRuntimeValues.join(" · ")}
              title={activeSession?.title ?? t("chat")}
            />
            <ChatPage
              approvals={approvals}
              composer={composer}
              desktopStatus={visibleDesktopStatus(desktopStatus)}
              hiddenMessageCount={hiddenMessageCount}
              isSessionLoading={isSessionLoading}
              isWorking={isWorking}
              messages={visibleMessages}
              messagesRef={messageListRef}
              onAddImages={addImageAttachments}
              onComposerChange={setComposer}
              onLoadOlderMessages={loadOlderMessages}
              onResolveApproval={resolveApproval}
              onRemoveAttachment={removePendingAttachment}
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
              deviceId={deviceId}
              relayApiKey={relayApiKey}
              relayEndpoint={relayEndpoint}
              relayError={relayError}
              relayState={relayState}
              desktopName={device.name}
              model={model}
              modelOptions={modelOptions}
              modelEffort={modelEffort}
              permissionMode={permissionMode}
              rateLimitUsage={rateLimitUsage}
              themeMode={themeMode}
              language={language}
              t={t}
              onDesktopDeviceIdChange={updateDesktopDeviceId}
              onModelChange={updateModel}
              onModelEffortChange={updateModelEffort}
              onPermissionModeChange={updatePermissionMode}
              onLanguageChange={updateLanguage}
              onRelayApiKeyChange={updateRelayApiKey}
              onRelayEndpointChange={updateRelayEndpoint}
              onThemeModeChange={updateThemeMode}
            />
          </div>
        ) : null}
      </section>

      <BottomNav activeView={activeView} onChange={setActiveView} t={t} />
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
  const favoriteSessions = workspaces.flatMap(workspace =>
    workspace.sessions
      .filter(session => favoriteSessionIds.has(session.id))
      .map(session => ({ workspace, session }))
  );

  return (
    <div className="pageStack">
      <section className="sectionBlock" aria-labelledby="session-browser-title">
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
            aria-selected={sessionTab === "favorites"}
            className="sessionTab"
            role="tab"
            type="button"
            onClick={() => onTabChange("favorites")}
          >
            {t("favorites")}
          </button>
        </div>

        <div className="workspaceTree">
          {sessionTab === "all" ? (
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
                            favorite={favoriteSessionIds.has(session.id)}
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
  desktopStatus,
  hiddenMessageCount,
  isSessionLoading,
  isWorking,
  messages,
  messagesRef,
  onAddImages,
  onComposerChange,
  onLoadOlderMessages,
  onRemoveAttachment,
  onResolveApproval,
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
  desktopStatus: string;
  hiddenMessageCount: number;
  isSessionLoading: boolean;
  isWorking: boolean;
  messages: Message[];
  messagesRef: RefObject<HTMLDivElement | null>;
  onAddImages: (files: FileList | File[]) => Promise<void>;
  onComposerChange: (value: string) => void;
  onLoadOlderMessages: () => void;
  onRemoveAttachment: (id: string) => void;
  onResolveApproval: (approvalId: string, decision: "accept" | "decline") => void;
  onSend: () => void;
  onStop: () => void;
  pendingAttachments: PendingImageAttachment[];
  turnDurationMs: number | null;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
  session?: Session;
}) {
  const canSend = composer.trim().length > 0 || pendingAttachments.length > 0;
  const statusState = isWorking ? "working" : session ? "ready" : "idle";
  const statusText = isWorking ? t("working") : session ? t("ready") : t("noSession");

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
            <div className="eventMarker active" aria-hidden="true" />
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
            {message.role === "event" ? (
              <div className="eventMarker" aria-hidden="true" />
            ) : null}
            <div className="messageBubble">
              {message.meta ? <small>{message.meta}</small> : null}
              <MarkdownContent text={message.text} />
              {message.attachments && message.attachments.length > 0 ? (
                <ImageAttachmentGrid attachments={message.attachments} t={t} />
              ) : null}
            </div>
          </article>
        ))}
        {isWorking ? (
          <article className="messageItem" data-role="event">
            <div className="eventMarker active" aria-hidden="true" />
            <div className="messageBubble">
              <small>{t("working")}</small>
              <p>{t("desktopRunningTurn")}</p>
            </div>
          </article>
        ) : null}
      </div>

      <div className="composerDock">
        <div className="composerStatus" data-state={statusState}>
          <span className="statusDot" aria-hidden="true" />
          <span>{statusText}</span>
          {turnDurationMs !== null ? (
            <span className="turnDuration">{formatTurnDuration(turnDurationMs)}</span>
          ) : null}
          {desktopStatus ? <small>{desktopStatus}</small> : null}
        </div>

        <form
          className="composer"
          onSubmit={event => {
            event.preventDefault();
            onSend();
          }}
        >
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
                    <img alt="" src={attachment.dataUrl} />
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
              onChange={event => onComposerChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              placeholder={t("composerPlaceholder")}
              rows={1}
              value={composer}
            />
            <div className="composerToolbar" aria-label={t("runtimeSettings")}>
              <div className="composerTools">
                <button
                  aria-label={t("addImages")}
                  className="composerIconButton"
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  <Plus size={17} />
                </button>
                <span className="composerDivider" aria-hidden="true" />
                <button
                  aria-label={t("fileMention")}
                  className="composerTextButton"
                  type="button"
                  onClick={() => onComposerChange(`${composer}@`)}
                >
                  <AtSign size={16} />
                  <span>{t("files")}</span>
                </button>
                <button
                  aria-label={t("skills")}
                  className="composerTextButton"
                  type="button"
                  onClick={() => onComposerChange(`${composer}$`)}
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
  deviceId,
  language,
  model,
  modelOptions,
  modelEffort,
  permissionMode,
  rateLimitUsage,
  relayApiKey,
  relayEndpoint,
  relayError,
  relayState,
  desktopName,
  t,
  themeMode,
  onDesktopDeviceIdChange,
  onLanguageChange,
  onModelChange,
  onModelEffortChange,
  onPermissionModeChange,
  onRelayApiKeyChange,
  onRelayEndpointChange,
  onThemeModeChange
}: {
  desktopDeviceId: string;
  deviceId: string;
  language: UILanguage;
  model: string;
  modelOptions: ModelOption[];
  modelEffort: ModelEffort;
  permissionMode: PermissionMode;
  rateLimitUsage: RateLimitUsage | null;
  relayApiKey: string;
  relayEndpoint: string;
  relayError: string;
  relayState: RelayConnectionState;
  desktopName: string;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
  themeMode: ThemeMode;
  onDesktopDeviceIdChange: (value: string) => void;
  onLanguageChange: (value: UILanguage) => void;
  onModelChange: (value: string) => void;
  onModelEffortChange: (value: ModelEffort) => void;
  onPermissionModeChange: (value: PermissionMode) => void;
  onRelayApiKeyChange: (value: string) => void;
  onRelayEndpointChange: (value: string) => void;
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
            <div className="settingsInputRow">
              <input
                autoCapitalize="none"
                autoCorrect="off"
                onChange={event => onDesktopDeviceIdChange(event.target.value)}
                placeholder="desktop-main"
                value={desktopDeviceId}
              />
              <button
                aria-label={t("copyDesktopDeviceId")}
                className="copyValueButton"
                type="button"
                onClick={() => void copySettingValue("desktopDeviceId", desktopDeviceId)}
              >
                {copiedField === "desktopDeviceId" ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedField === "desktopDeviceId" ? t("copied") : t("copy")}</span>
              </button>
            </div>
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
        <SettingsRow
          icon={<Bell size={18} />}
          label={t("notifications")}
          value={t("notConfigured")}
        />
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
  onChange,
  t
}: {
  activeView: ViewMode;
  onChange: (view: ViewMode) => void;
  t: (key: UIMessageKey, values?: Record<string, string | number>) => string;
}) {
  return (
    <nav className="bottomNav" aria-label={t("primary")}>
      <NavItem
        active={activeView === "sessions"}
        icon={<ListChecks size={20} />}
        label={t("sessions")}
        onClick={() => onChange("sessions")}
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
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="navItem" data-active={active} onClick={onClick} type="button">
      {icon}
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
  return normalized.split("/").filter(Boolean).at(-1) || path || "Workspace";
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
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.hostname}:8909`;
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
      text = text.replaceAll(`{${name}}`, String(value));
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
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
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
  apiKey: string
): string | null {
  const base = endpoint.trim().replace(/\/+$/, "");
  if (!base) {
    return null;
  }
  const separator = base.includes("?") ? "&" : "?";
  const url = `${base}/ws/${role}${separator}device_id=${encodeURIComponent(
    deviceId
  )}&api_key=${encodeURIComponent(apiKey)}`;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
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
