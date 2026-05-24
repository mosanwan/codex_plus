import {
  Check,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Send,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CodexAdapterEvent, Thread, UserInput } from "@codep/codex-adapter";

interface SessionView {
  threadId: string;
  title: string;
  updatedAt?: number;
  status?: string;
}

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
}

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

interface ClipboardAttachmentResult {
  attachments: ComposerAttachment[];
  formats: string[];
}

type ConnectionState = "disconnected" | "connecting" | "connected";
const WORKSPACE_STORAGE_KEY = "codep.lastWorkspace";
const SESSION_STORAGE_KEY = "codep.sessionsByWorkspace";
const INITIAL_VISIBLE_TRANSCRIPT_COUNT = 40;
const TRANSCRIPT_PAGE_SIZE = 40;
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
  const [workspace, setWorkspace] = useState<string | null>(() =>
    DEMO_MODE ? DEMO_WORKSPACE : window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
  );
  const [session, setSession] = useState<SessionView | null>(
    DEMO_MODE ? DEMO_SESSION : null
  );
  const [sessions, setSessions] = useState<SessionView[]>(
    DEMO_MODE ? [DEMO_SESSION] : []
  );
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);
  const [isSessionOpening, setIsSessionOpening] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>(
    DEMO_MODE ? DEMO_TRANSCRIPT : []
  );
  const [approvals, setApprovals] = useState<ApprovalEntry[]>([]);
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [visibleTranscriptCount, setVisibleTranscriptCount] = useState(
    INITIAL_VISIBLE_TRANSCRIPT_COUNT
  );
  const [scrollRequest, setScrollRequest] = useState(0);
  const [historyLoadRequest, setHistoryLoadRequest] = useState(0);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const previousHistoryScrollHeight = useRef(0);
  const lastPasteEventAt = useRef(0);
  const [status, setStatus] = useState(() =>
    DEMO_MODE
      ? "Demo layout fixture."
      : window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
      ? "Restored previous workspace."
      : "Choose a workspace to begin."
  );

  useEffect(() => {
    if (DEMO_MODE) {
      return undefined;
    }

    if (!desktopApi) {
      setStatus("Electron preload API is not available.");
      return undefined;
    }

    return desktopApi.onEvent(event => {
      if (event.type === "turn.started") {
        setActiveTurnId(event.turnId);
        setTranscript(previous => [
          ...previous,
          {
            id: `turn-started-${event.turnId}`,
            role: "turn",
            text: "Turn started",
            meta: event.turnId.slice(0, 8)
          }
        ]);
        requestScrollToBottom();
        setStatus("Codex is working.");
      }

      if (event.type === "message.delta") {
        setTranscript(previous => appendAssistantDelta(previous, event.text));
        requestScrollToBottom();
      }

      if (event.type === "command.delta") {
        const id = event.itemId ?? `${event.stream}-${event.turnId}`;
        setTranscript(previous =>
          appendCommandTimelineDelta(previous, id, event.stream, event.text)
        );
        requestScrollToBottom();
      }

      if (event.type === "plan.updated") {
        setTranscript(previous =>
          upsertTimelineEvent(previous, {
            id: `plan-${event.turnId}`,
            role: "plan",
            text: planSummary(event.plan),
            meta: event.turnId.slice(0, 8)
          })
        );
        requestScrollToBottom();
      }

      if (event.type === "diff.updated" || event.type === "file.patch.updated") {
        const value = event.type === "diff.updated" ? event.diff : event.patch;
        setTranscript(previous =>
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
        requestScrollToBottom();
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
        setTranscript(previous =>
          upsertTimelineEvent(previous, {
            id: `approval-${String(event.requestId)}`,
            role: "approval",
            text: approvalSummary(event.request),
            meta: event.approvalType
          })
        );
        requestScrollToBottom();
        setStatus("Approval requested.");
      }

      if (event.type === "raw.notification") {
        const entry = timelineEntryFromRawNotification(event);
        if (entry) {
          setTranscript(previous => upsertTimelineEvent(previous, entry));
          requestScrollToBottom();
        }
      }

      if (event.type === "turn.completed") {
        setActiveTurnId(null);
        setStatus("Turn completed.");
      }
    });
  }, [desktopApi]);

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

    if (!workspace || !desktopApi || connectionState !== "connected") {
      return;
    }

    void refreshSessions(workspace);
  }, [connectionState, desktopApi, workspace]);

  const canStartSession =
    connectionState === "connected" &&
    workspace !== null &&
    session === null &&
    !isSessionOpening;
  const isTurnRunning = activeTurnId !== null;
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
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, selected);
      setWorkspace(selected);
      setSession(null);
      setSessions([]);
      setTranscript([]);
      resetVisibleTranscriptWindow();
      setAttachments([]);
      setApprovals([]);
      setActiveTurnId(null);
      setStatus("Workspace selected. Opening session.");
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

  async function startSession() {
    if (!workspace || !desktopApi) {
      return;
    }

    setStatus("Creating Codex thread.");
    setIsSessionOpening(true);
    try {
      const savedSession = readSavedSession(workspace);
      const latestSession = sessions[0] ?? savedSession;
      const response = latestSession
        ? await desktopApi
            .resumeThread({ threadId: latestSession.threadId, cwd: workspace })
            .catch(() => desktopApi.startThread({ cwd: workspace }))
        : await desktopApi.startThread({ cwd: workspace });
      const nextSession = {
        threadId: response.thread.id,
        title: response.thread.preview || shortWorkspace,
        updatedAt: response.thread.updatedAt
      };
      setSession(nextSession);
      saveSession(workspace, nextSession);
      setSessions(previous => upsertSession(previous, nextSession));
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

    setIsSessionOpening(true);
    setStatus("Creating new Codex session.");
    try {
      const response = await desktopApi.startThread({ cwd: workspace });
      const nextSession = {
        threadId: response.thread.id,
        title: response.thread.preview || "New session",
        updatedAt: response.thread.updatedAt
      };
      setSession(nextSession);
      saveSession(workspace, nextSession);
      setSessions(previous => upsertSession(previous, nextSession));
      resetVisibleTranscriptWindow();
      setTranscript([
        systemEntry(`New session started in ${workspace}`)
      ]);
      requestScrollToBottom();
      setStatus("New session ready.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSessionOpening(false);
    }
  }

  async function openSession(target: SessionView) {
    if (!workspace || !desktopApi || isSessionOpening) {
      return;
    }

    setIsSessionOpening(true);
    setStatus("Resuming session.");
    try {
      const response = await desktopApi.resumeThread({
        threadId: target.threadId,
        cwd: workspace
      });
      const nextSession = {
        threadId: response.thread.id,
        title: response.thread.preview || target.title || shortWorkspace,
        updatedAt: response.thread.updatedAt
      };
      setSession(nextSession);
      saveSession(workspace, nextSession);
      resetVisibleTranscriptWindow();
      setTranscript([
        ...transcriptFromThread(response.thread),
        systemEntry(`Session resumed in ${workspace}`)
      ]);
      requestScrollToBottom();
      setStatus("Session resumed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSessionOpening(false);
    }
  }

  async function refreshSessions(cwd: string) {
    if (!desktopApi) {
      return;
    }

    setIsSessionsLoading(true);
    try {
      const response = await desktopApi.listThreads({ cwd });
      const nextSessions = response.data.map(thread => ({
        threadId: thread.id,
        title: thread.preview || thread.name || shortWorkspace,
        updatedAt: thread.updatedAt,
        status:
          typeof thread.status === "string"
            ? thread.status
            : JSON.stringify(thread.status)
      }));
      setSessions(nextSessions);

      if (!session) {
        const savedSession = readSavedSession(cwd);
        const preferred =
          nextSessions.find(item => item.threadId === savedSession?.threadId) ??
          nextSessions[0];
        if (preferred) {
          void openSession(preferred);
        } else {
          void startSession();
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSessionsLoading(false);
    }
  }

  async function sendTurn() {
    if (
      !desktopApi ||
      !session ||
      (composer.trim().length === 0 && attachments.length === 0)
    ) {
      return;
    }

    const text = composer.trim();
    const outgoingAttachments = attachments;
    const input = buildTurnInput(text, outgoingAttachments);
    const displayText = userTranscriptText(text, outgoingAttachments);
    setComposer("");
    setAttachments([]);
    resetVisibleTranscriptWindow();
    setTranscript(previous => [
      ...previous,
      { id: `user-${Date.now()}`, role: "user", text: displayText }
    ]);
    requestScrollToBottom();
    setStatus("Sending turn.");

    try {
      const response = await desktopApi.startTurn({
        threadId: session.threadId,
        text,
        input
      });
      setActiveTurnId(response.turn.id);
      requestScrollToBottom();
    } catch (error) {
      setActiveTurnId(null);
      setAttachments(outgoingAttachments);
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent & {
      isComposing?: boolean;
    };

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

  async function interruptTurn() {
    if (!desktopApi || !session || !activeTurnId) {
      return;
    }

    const interruptedTurnId = activeTurnId;
    setStatus("Interrupting current turn.");
    try {
      await desktopApi.interruptTurn({
        threadId: session.threadId,
        turnId: interruptedTurnId
      });
      setActiveTurnId(null);
      setStatus("Turn interrupted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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

  return (
    <main className={`shell${isSidebarCollapsed ? " sidebarCollapsed" : ""}`}>
      <aside
        className="sidebar"
        aria-label="Workspace and sessions"
        data-collapsed={isSidebarCollapsed}
      >
        <div className="brand">
          <div className="brandMark">C</div>
          <div className="brandText">
            <h1>CodeP</h1>
            <p>Local Codex workspace</p>
          </div>
          <button
            className="sidebarToggle"
            type="button"
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
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

        <section className="panel grow">
          <div className="panelHeader">
            <h2>Sessions</h2>
            <div className="panelActions">
              <button
                className="miniButton"
                type="button"
                onClick={startSession}
                disabled={!canStartSession}
              >
                Latest
              </button>
              <button
                className="miniButton primaryMiniButton"
                type="button"
                onClick={startNewSession}
                disabled={connectionState !== "connected" || !workspace || isSessionOpening}
              >
                New
              </button>
            </div>
          </div>
          {isSessionsLoading ? (
            <p className="emptyText">Loading sessions...</p>
          ) : sessions.length > 0 ? (
            <div className="sessionList">
              {sessions.map(item => (
                <button
                  className="sessionItem"
                  data-active={item.threadId === session?.threadId}
                  key={item.threadId}
                  type="button"
                  onClick={() => void openSession(item)}
                >
                  <span>{item.title}</span>
                  <small>{sessionMeta(item)}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="emptyText">No active session</p>
          )}
        </section>

        <section className="workspaceDock" aria-label="Workspace">
          <div className="panelHeader">
            <h2>Workspace</h2>
          </div>
          <button className="pathButton" type="button" onClick={chooseWorkspace}>
            <FolderOpen size={16} />
            <span>{shortWorkspace}</span>
          </button>
          {workspace ? <p className="pathFull">{workspace}</p> : null}
        </section>
      </aside>

      <section className="conversation" aria-label="Conversation">
        <header className="topbar">
          <div>
            <h2>{session?.title ?? "New Codex session"}</h2>
            <p>{status}</p>
          </div>
          <div className="topbarActions">
            <div className="statusPill" data-state={connectionState}>
              {connectionState}
            </div>
          </div>
        </header>

        <div className="messages" role="log" aria-live="polite" ref={messagesRef}>
          {transcript.length === 0 ? (
            <div className="emptyState">
              <h2>Start a local Codex session</h2>
              <p>Choose a workspace, then open the latest session or create a new one.</p>
            </div>
          ) : (
            <div className="timeline">
              {hiddenTranscriptCount > 0 ? (
                <div className="historyLoader">
                  <button type="button" onClick={loadOlderTranscript}>
                    Load {Math.min(TRANSCRIPT_PAGE_SIZE, hiddenTranscriptCount)} older
                    messages
                  </button>
                  <span>{hiddenTranscriptCount} hidden</span>
                </div>
              ) : null}
              {visibleTranscript.map(entry => (
                <TimelineEntry entry={entry} key={entry.id} />
              ))}
              {isTurnRunning ? (
                <div className="timelineItem workingItem" aria-live="polite">
                  <span className="timelineMarker" aria-hidden="true" />
                  <div className="timelineContent">
                    <div className="timelineMeta">
                      <strong>Working</strong>
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
            onResolveApproval={resolveApproval}
          />
          <div
            className="composerStatus"
            data-state={isTurnRunning ? "working" : session ? "ready" : "idle"}
          >
            <span className="statusDot" aria-hidden="true" />
            <span className="statusText">
              {isTurnRunning ? "Working" : session ? "Ready" : "No session"}
            </span>
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
            <div className="composerMain">
              {attachments.length > 0 ? (
                <div className="attachmentShelf" aria-label="Attached files">
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
                          {attachment.type === "localImage" ? "Image" : "File mention"}
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
                aria-label="Message Codex"
                placeholder="Ask Codex to inspect, edit, explain, or test this workspace"
                value={composer}
                disabled={session === null}
                onChange={event => setComposer(event.target.value)}
                onPaste={handleComposerPaste}
                onKeyDown={handleComposerKeyDown}
              />
            </div>
            <button
              className="sendButton"
              type="submit"
              disabled={!canSubmit}
              data-mode="send"
            >
              <Send size={16} />
              <span>Send</span>
            </button>
          </form>
        </div>
      </section>

    </main>
  );
}

function buildTurnInput(text: string, attachments: ComposerAttachment[]): UserInput[] {
  const inputText =
    text.length > 0
      ? text
      : attachments.some(attachment => attachment.type === "localImage")
        ? "Please inspect the attached image."
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

function TimelineEntry({ entry }: { entry: TranscriptEntry }) {
  return (
    <article className="timelineItem" data-role={entry.role}>
      <span className="timelineMarker" aria-hidden="true" />
      <div className="timelineContent">
        <div className="timelineMeta">
          <strong>{roleLabel(entry.role)}</strong>
          {entry.meta ? <code>{entry.meta}</code> : null}
        </div>
        <MarkdownContent text={entry.text || "..."} />
      </div>
    </article>
  );
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="markdownContent">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

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
  onResolveApproval: (
    approval: ApprovalEntry,
    decision: "accept" | "decline" | "cancel"
  ) => Promise<void>;
}) {
  if (props.approvals.length === 0) {
    return null;
  }

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
              <span>Accept</span>
            </button>
            <button
              className="declineButton"
              type="button"
              onClick={() => void props.onResolveApproval(approval, "decline")}
            >
              <X size={14} />
              <span>Decline</span>
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

  next.push({ id: `assistant-${Date.now()}`, role: "assistant", text: delta });
  return next;
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

function roleLabel(role: TranscriptEntry["role"]): string {
  switch (role) {
    case "assistant":
      return "Codex";
    case "user":
      return "You";
    case "system":
      return "System";
    case "turn":
      return "Turn";
    case "command":
      return "Ran";
    case "commandOutput":
      return "Output";
    case "tool":
      return "Tool";
    case "edited":
      return "Edited";
    case "viewedImage":
      return "Viewed Image";
    case "interaction":
      return "Interacted";
    case "search":
      return "Search";
    case "plan":
      return "Plan";
    case "diff":
      return "Diff";
    case "approval":
      return "Approval";
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

function eventSummary(event: CodexAdapterEvent): string {
  switch (event.type) {
    case "message.delta":
    case "reasoning.delta":
      return event.text;
    case "command.delta":
      return `${event.stream}: ${event.text}`;
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
