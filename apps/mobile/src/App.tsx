import {
  Bell,
  ChevronRight,
  Check,
  Code2,
  Database,
  FolderOpen,
  Laptop,
  ListChecks,
  Lock,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Square,
  Star,
  Wifi,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
import {
  mockSnapshot,
  type Approval,
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
  const [sessionTab, setSessionTab] = useState<SessionTab>("all");
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
  const [modelEffort, setModelEffort] = useState<ModelEffort>(mockSnapshot.modelEffort);
  const [contextUsage, setContextUsage] = useState(mockSnapshot.contextUsage);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readSavedThemeMode());
  const [isWorking, setIsWorking] = useState(true);
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
  const hiddenMessageCount = Math.max(messages.length - visibleMessageCount, 0);
  const visibleMessages = useMemo(
    () => messages.slice(hiddenMessageCount),
    [hiddenMessageCount, messages]
  );

  const pageTitle = useMemo(() => {
    if (activeView === "sessions") {
      return "Sessions";
    }
    if (activeView === "settings") {
      return "Settings";
    }
    return activeSession?.title ?? "Chat";
  }, [activeSession?.title, activeView]);
  const connectionText =
    device.connection.slice(0, 1).toUpperCase() + device.connection.slice(1);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
  }, [themeMode]);

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
  }, [approvals.length, isWorking, messages.length]);

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
      Math.min(previous + MESSAGE_PAGE_SIZE, messages.length)
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
        text: text.length > 0 ? text : "Sent images",
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
    publishRelay({
      type: "client.new_session",
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
      <header className="appHeader">
        <div>
          <h1>{pageTitle}</h1>
          <p>
            {device.name} · {model} {effortLabel(modelEffort)} ·{" "}
            {contextLabel(contextUsage)}
          </p>
        </div>
        <div className="connectionPill" data-state={device.connection}>
          {connectionText}
        </div>
      </header>

      <section className="pageViewport" aria-live="polite">
        {activeView === "sessions" ? (
          <SessionsPage
            activeSessionId={activeSessionId}
            activeWorkspace={activeWorkspace}
            collapsedWorkspaces={collapsedWorkspaces}
            favoriteSessionIds={favoriteSessionIds}
            onOpenSession={openSession}
            onRenameSession={renameSession}
            onStartSession={startSessionInWorkspace}
            onTabChange={setSessionTab}
            onToggleFavorite={toggleFavoriteSession}
            onToggleWorkspace={toggleWorkspaceCollapsed}
            sessionTab={sessionTab}
            workspaces={visibleWorkspaces}
          />
        ) : null}
        {activeView === "chat" ? (
          <ChatPage
            approvals={approvals}
            composer={composer}
            hiddenMessageCount={hiddenMessageCount}
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
            attachmentInputRef={attachmentInputRef}
            session={activeSession}
          />
        ) : null}
        {activeView === "settings" ? (
          <SettingsPage
            desktopDeviceId={desktopDeviceId}
            deviceId={deviceId}
            relayApiKey={relayApiKey}
            relayEndpoint={relayEndpoint}
            relayError={relayError}
            relayState={relayState}
            model={model}
            modelEffort={modelEffort}
            permissionMode={permissionMode}
            themeMode={themeMode}
            onDesktopDeviceIdChange={updateDesktopDeviceId}
            onModelChange={updateModel}
            onModelEffortChange={updateModelEffort}
            onPermissionModeChange={updatePermissionMode}
            onRelayApiKeyChange={updateRelayApiKey}
            onRelayEndpointChange={updateRelayEndpoint}
            onThemeModeChange={updateThemeMode}
          />
        ) : null}
      </section>

      <BottomNav activeView={activeView} onChange={setActiveView} />
    </main>
  );
}

function SessionsPage({
  activeSessionId,
  activeWorkspace,
  collapsedWorkspaces,
  favoriteSessionIds,
  onOpenSession,
  onRenameSession,
  onStartSession,
  onTabChange,
  onToggleFavorite,
  onToggleWorkspace,
  sessionTab,
  workspaces
}: {
  activeSessionId: string | null;
  activeWorkspace: string | null;
  collapsedWorkspaces: Set<string>;
  favoriteSessionIds: Set<string>;
  onOpenSession: (sessionId: string) => void;
  onRenameSession: (workspace: string, session: Session, title: string) => void;
  onStartSession: (workspace: string) => void;
  onTabChange: (tab: SessionTab) => void;
  onToggleFavorite: (sessionId: string) => void;
  onToggleWorkspace: (workspace: string) => void;
  sessionTab: SessionTab;
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
          <h2 id="session-browser-title">Session browser</h2>
          <span>{workspaces.length}</span>
        </div>
        <div className="sessionTabs" role="tablist" aria-label="Session views">
          <button
            aria-selected={sessionTab === "all"}
            className="sessionTab"
            role="tab"
            type="button"
            onClick={() => onTabChange("all")}
          >
            All
          </button>
          <button
            aria-selected={sessionTab === "favorites"}
            className="sessionTab"
            role="tab"
            type="button"
            onClick={() => onTabChange("favorites")}
          >
            Favorites
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
                          ? `Expand ${workspace.name}`
                          : `Collapse ${workspace.name}`
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
                    <div className="workspaceIdentity">
                      <FolderOpen size={17} />
                      <div>
                        <strong>{workspace.name}</strong>
                        <small>{workspace.path}</small>
                      </div>
                    </div>
                    <button
                      aria-label={`New session in ${workspace.name}`}
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
                            onOpen={() => onOpenSession(session.id)}
                            onRename={title => onRenameSession(workspace.path, session, title)}
                            session={session}
                          />
                        ))
                      ) : (
                        <p className="emptyText">No sessions in this workspace.</p>
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
                onOpen={() => onOpenSession(session.id)}
                onRename={title => onRenameSession(workspace.path, session, title)}
                session={session}
              />
            ))
          ) : (
            <p className="emptyText">Star sessions to keep them in this view.</p>
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
  onOpen,
  onRename,
  session
}: {
  active: boolean;
  favorite: boolean;
  meta?: string;
  onFavorite: () => void;
  onOpen: () => void;
  onRename: (title: string) => void | Promise<void>;
  session: Session;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
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
            aria-label="Session name"
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
          <button aria-label="Save session name" className="miniIconButton" type="submit">
            <Check size={16} />
          </button>
          <button
            aria-label="Cancel rename"
            className="miniIconButton"
            type="button"
            onClick={cancelRename}
          >
            <X size={16} />
          </button>
        </form>
      ) : (
        <>
          <button className="sessionOpenButton" type="button" onClick={onOpen}>
            <div>
              <span>{session.title}</span>
              <small>{meta ?? `${session.id} · ${session.updatedAt}`}</small>
            </div>
            <SessionStatus status={session.status} />
          </button>
          <button
            aria-label={favorite ? `Unfavorite ${session.title}` : `Favorite ${session.title}`}
            className="miniIconButton"
            data-active={favorite}
            type="button"
            onClick={onFavorite}
          >
            <Star fill={favorite ? "currentColor" : "none"} size={16} />
          </button>
          <button
            aria-label={`Rename ${session.title}`}
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
  hiddenMessageCount,
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
  session
}: {
  approvals: Approval[];
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  composer: string;
  hiddenMessageCount: number;
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
  session?: Session;
}) {
  const canSend = composer.trim().length > 0 || pendingAttachments.length > 0;

  return (
    <div className="chatLayout">
      <div className="chatSubheader">
        <div>
          <strong>{session?.id ?? "No session"}</strong>
          <span>{isWorking ? "Working on desktop" : "Ready"}</span>
        </div>
        <SessionStatus status={isWorking ? "working" : session?.status ?? "ready"} />
      </div>

      <div
        className="messageList"
        role="log"
        aria-label="Chat messages"
        ref={messagesRef}
      >
        {hiddenMessageCount > 0 ? (
          <div className="historyLoader">
            <button type="button" onClick={onLoadOlderMessages}>
              Load {Math.min(MESSAGE_PAGE_SIZE, hiddenMessageCount)} older messages
            </button>
            <span>{hiddenMessageCount} hidden</span>
          </div>
        ) : null}
        {approvals.length > 0 ? (
          <section className="chatApprovals" aria-labelledby="chat-approvals-title">
            <div className="sectionHeader">
              <h2 id="chat-approvals-title">Pending approvals</h2>
              <span>{approvals.length}</span>
            </div>
            <div className="approvalList compact">
              {approvals.map(approval => (
                <ApprovalCard
                  approval={approval}
                  key={approval.id}
                  onResolve={onResolveApproval}
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
              <p>{message.text}</p>
              {message.attachments && message.attachments.length > 0 ? (
                <ImageAttachmentGrid attachments={message.attachments} />
              ) : null}
            </div>
          </article>
        ))}
        {isWorking ? (
          <article className="messageItem" data-role="event">
            <div className="eventMarker active" aria-hidden="true" />
            <div className="messageBubble">
              <small>working</small>
              <p>Desktop Codex is running this turn.</p>
            </div>
          </article>
        ) : null}
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
          aria-label="Image attachments"
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
        <button
          aria-label="Add images"
          className="iconButton"
          type="button"
          onClick={() => attachmentInputRef.current?.click()}
        >
          <Paperclip size={18} />
        </button>
        <div className="composerField">
          {pendingAttachments.length > 0 ? (
            <div className="attachmentStrip" aria-label="Selected images">
              {pendingAttachments.map(attachment => (
                <div className="attachmentPreview" key={attachment.id}>
                  <img alt="" src={attachment.dataUrl} />
                  <span>{attachment.name}</span>
                  <button
                    aria-label={`Remove ${attachment.name}`}
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
            aria-label="Message Codex"
            onChange={event => onComposerChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder="Message Codex on your desktop"
            rows={1}
            value={composer}
          />
        </div>
        {isWorking && !canSend ? (
          <button
            aria-label="Stop current turn"
            className="sendButton"
            data-mode="stop"
            onClick={onStop}
            type="button"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            aria-label="Send message"
            className="sendButton"
            disabled={!canSend}
            type="submit"
          >
            <Send size={16} />
          </button>
        )}
      </form>
    </div>
  );
}

function ImageAttachmentGrid({ attachments }: { attachments: MessageAttachment[] }) {
  return (
    <div className="messageAttachmentGrid" aria-label="Attached images">
      {attachments.map(attachment => (
        <figure key={attachment.id}>
          <img alt={attachment.name} src={attachment.dataUrl} />
          <figcaption>{attachment.name}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function SettingsPage({
  desktopDeviceId,
  deviceId,
  model,
  modelEffort,
  permissionMode,
  relayApiKey,
  relayEndpoint,
  relayError,
  relayState,
  themeMode,
  onDesktopDeviceIdChange,
  onModelChange,
  onModelEffortChange,
  onPermissionModeChange,
  onRelayApiKeyChange,
  onRelayEndpointChange,
  onThemeModeChange
}: {
  desktopDeviceId: string;
  deviceId: string;
  model: string;
  modelEffort: ModelEffort;
  permissionMode: PermissionMode;
  relayApiKey: string;
  relayEndpoint: string;
  relayError: string;
  relayState: RelayConnectionState;
  themeMode: ThemeMode;
  onDesktopDeviceIdChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onModelEffortChange: (value: ModelEffort) => void;
  onPermissionModeChange: (value: PermissionMode) => void;
  onRelayApiKeyChange: (value: string) => void;
  onRelayEndpointChange: (value: string) => void;
  onThemeModeChange: (value: ThemeMode) => void;
}) {
  return (
    <div className="pageStack">
      <section className="settingsHero">
        <div className="brandMark">C</div>
        <div>
          <h2>CodeP Mobile</h2>
          <p>Browser-first remote control shell</p>
        </div>
      </section>

      <section className="sectionBlock">
        <h2>Connection</h2>
        <div className="settingsForm">
          <label className="settingsField">
            <span>Relay endpoint</span>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="url"
              onChange={event => onRelayEndpointChange(event.target.value)}
              placeholder="ws://server:8787"
              value={relayEndpoint}
            />
          </label>
          <label className="settingsField">
            <span>Desktop device ID</span>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              onChange={event => onDesktopDeviceIdChange(event.target.value)}
              placeholder="desktop-main"
              value={desktopDeviceId}
            />
          </label>
          <label className="settingsField">
            <span>API key</span>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              onChange={event => onRelayApiKeyChange(event.target.value)}
              placeholder="cp_..."
              type="password"
              value={relayApiKey}
            />
          </label>
          <p className="settingsHelp">
            Use the same API key as the desktop app. The endpoint should point to
            the Go relay server. The desktop device ID must match the desktop
            Settings dialog.
          </p>
          {relayError ? <p className="settingsError">{relayError}</p> : null}
        </div>
        <SettingsRow
          icon={<Wifi size={18} />}
          label="Relay mode"
          value={relayApiKey ? relayState : "Missing key"}
        />
        <SettingsRow
          icon={<Laptop size={18} />}
          label="Desktop"
          value="three workstation"
        />
        <SettingsRow
          icon={<Smartphone size={18} />}
          label="Device"
          value={deviceId.slice(0, 18)}
        />
      </section>

      <section className="sectionBlock">
        <h2>Appearance</h2>
        <label className="settingsField">
          <span>Theme</span>
          <select
            value={themeMode}
            onChange={event => onThemeModeChange(event.target.value as ThemeMode)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <p className="settingsHelp">Applies to all mobile app surfaces.</p>
      </section>

      <section className="sectionBlock">
        <h2>Model</h2>
        <label className="settingsField">
          <span>Model</span>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            list="mobile-model-options"
            value={model}
            onChange={event => onModelChange(event.target.value)}
          />
          <datalist id="mobile-model-options">
            {MODEL_OPTIONS.map(option => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>
        <label className="settingsField">
          <span>Reasoning level</span>
          <select
            value={modelEffort}
            onChange={event => onModelEffortChange(event.target.value as ModelEffort)}
          >
            {EFFORT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="settingsHelp">{effortDescription(modelEffort)}</p>
        <SettingsRow
          icon={<Code2 size={18} />}
          label="Active model"
          value={`${model} ${effortLabel(modelEffort)}`}
        />
      </section>

      <section className="sectionBlock">
        <h2>Safety</h2>
        <label className="settingsField">
          <span>Default /permissions</span>
          <select
            value={permissionMode}
            onChange={event =>
              onPermissionModeChange(event.target.value as PermissionMode)
            }
          >
            {PERMISSION_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="settingsHelp">{permissionDescription(permissionMode)}</p>
        <SettingsRow
          icon={<ShieldCheck size={18} />}
          label="Permissions"
          value={permissionLabel(permissionMode)}
        />
        <SettingsRow
          icon={<Lock size={18} />}
          label="Workspace boundary"
          value="Enforced"
        />
        <SettingsRow
          icon={<Bell size={18} />}
          label="Notifications"
          value="Not configured"
        />
      </section>

      <section className="sectionBlock">
        <h2>Developer</h2>
        <SettingsRow
          icon={<Code2 size={18} />}
          label="Android shell"
          value="Capacitor"
        />
        <SettingsRow
          icon={<Database size={18} />}
          label="Data source"
          value="Relay snapshot"
        />
      </section>
    </div>
  );
}

function BottomNav({
  activeView,
  onChange
}: {
  activeView: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  return (
    <nav className="bottomNav" aria-label="Primary">
      <NavItem
        active={activeView === "sessions"}
        icon={<ListChecks size={20} />}
        label="Sessions"
        onClick={() => onChange("sessions")}
      />
      <NavItem
        active={activeView === "chat"}
        icon={<MessageCircle size={20} />}
        label="Chat"
        onClick={() => onChange("chat")}
      />
      <NavItem
        active={activeView === "settings"}
        icon={<Settings size={20} />}
        label="Settings"
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
  onResolve
}: {
  approval: Approval;
  onResolve: (approvalId: string, decision: "accept" | "decline") => void;
}) {
  return (
    <article className="approvalCard" data-risk={approval.risk}>
      <div>
        <small>{approval.risk} risk</small>
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
          Decline
        </button>
        <button
          className="primaryButton"
          type="button"
          onClick={() => onResolve(approval.id, "accept")}
        >
          <Check size={15} />
          Approve
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

function SessionStatus({ status }: { status: Session["status"] }) {
  return (
    <span className="sessionStatus" data-state={status}>
      {status}
    </span>
  );
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

function readSavedThemeMode(): ThemeMode {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" ? "light" : "dark";
}

function defaultMobileRelayEndpoint(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.hostname}:8788`;
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

function permissionLabel(value: PermissionMode): string {
  return PERMISSION_OPTIONS.find(option => option.value === value)?.label ?? value;
}

function permissionDescription(value: PermissionMode): string {
  return (
    PERMISSION_OPTIONS.find(option => option.value === value)?.description ??
    "Custom approval policy."
  );
}

function effortLabel(value: ModelEffort): string {
  return EFFORT_OPTIONS.find(option => option.value === value)?.label ?? value;
}

function effortDescription(value: ModelEffort): string {
  return EFFORT_OPTIONS.find(option => option.value === value)?.description ?? value;
}

function contextLabel(
  usage: { usedTokens: number; contextWindow: number | null } | null
): string {
  if (!usage) {
    return "context unknown";
  }
  if (usage.contextWindow && usage.contextWindow > 0) {
    const remaining = Math.max(usage.contextWindow - usage.usedTokens, 0);
    return `${formatTokenCount(remaining)} left`;
  }
  return `${formatTokenCount(usage.usedTokens)} used`;
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
