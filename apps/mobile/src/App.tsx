import {
  Check,
  ChevronRight,
  Code2,
  Laptop,
  MessageSquare,
  Paperclip,
  Send,
  ShieldCheck,
  Square,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import { mockSnapshot, type Approval, type Message, type ViewMode } from "./remote";

export function App() {
  const [activeView, setActiveView] = useState<ViewMode>("chat");
  const [composer, setComposer] = useState("");
  const [messages, setMessages] = useState(mockSnapshot.messages);
  const [isWorking, setIsWorking] = useState(true);
  const { approvals, device, diffLines, sessions } = mockSnapshot;
  const activeSession =
    sessions.find(session => session.id === mockSnapshot.activeSessionId) ?? sessions[0];

  const connectionText = useMemo(() => {
    if (device.connection === "online") {
      return "Online";
    }
    if (device.connection === "pairing") {
      return "Pairing";
    }
    return "Offline";
  }, []);

  function sendMessage() {
    const text = composer.trim();
    if (text.length === 0) {
      return;
    }

    setMessages(previous => [
      ...previous,
      { id: `local-${Date.now()}`, role: "user", text }
    ]);
    setComposer("");
    setIsWorking(true);
  }

  function stopTurn() {
    setIsWorking(false);
  }

  return (
    <main className="mobileShell">
      <header className="appHeader">
        <div className="brandCluster">
          <div className="brandMark">C</div>
          <div>
            <h1>CodeP</h1>
            <p>Mobile remote control</p>
          </div>
        </div>
        <div className="connectionPill" data-state={device.connection}>
          {connectionText}
        </div>
      </header>

      <section className="devicePanel" aria-label="Connected desktop">
        <div className="deviceIcon">
          <Laptop size={20} />
        </div>
        <div>
          <h2>{device.name}</h2>
          <p>{device.workspace}</p>
        </div>
        <ChevronRight size={18} />
      </section>

      <section className="sessionStrip" aria-label="Sessions">
        {sessions.map(session => (
          <button
            className="sessionChip"
            data-active={session.id === activeSession.id}
            key={session.id}
            type="button"
          >
            <span>{session.title}</span>
            <small>
              {session.id} · {session.updatedAt}
            </small>
          </button>
        ))}
      </section>

      <nav className="viewTabs" aria-label="Mobile views">
        <TabButton
          active={activeView === "chat"}
          icon={<MessageSquare size={16} />}
          label="Chat"
          onClick={() => setActiveView("chat")}
        />
        <TabButton
          active={activeView === "approvals"}
          icon={<ShieldCheck size={16} />}
          label="Approval"
          onClick={() => setActiveView("approvals")}
        />
        <TabButton
          active={activeView === "diff"}
          icon={<Code2 size={16} />}
          label="Diff"
          onClick={() => setActiveView("diff")}
        />
      </nav>

      <section className="contentPane" aria-live="polite">
        {activeView === "chat" ? (
          <ChatView isWorking={isWorking} messages={messages} />
        ) : null}
        {activeView === "approvals" ? <ApprovalView approvals={approvals} /> : null}
        {activeView === "diff" ? <DiffView lines={diffLines} /> : null}
      </section>

      <footer className="composerDock">
        <div className="runtimeStatus" data-state={isWorking ? "working" : "ready"}>
          <span />
          {isWorking ? "Working on desktop" : "Ready"}
        </div>
        <form
          className="composer"
          onSubmit={event => {
            event.preventDefault();
            sendMessage();
          }}
        >
          <button
            aria-label="Attach file"
            className="iconButton"
            type="button"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            aria-label="Message Codex"
            onChange={event => setComposer(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Message Codex on your desktop"
            rows={1}
            value={composer}
          />
          {isWorking && composer.trim().length === 0 ? (
            <button
              aria-label="Stop current turn"
              className="sendButton"
              data-mode="stop"
              onClick={stopTurn}
              type="button"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              aria-label="Send message"
              className="sendButton"
              disabled={composer.trim().length === 0}
              type="submit"
            >
              <Send size={16} />
            </button>
          )}
        </form>
      </footer>
    </main>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="tabButton" data-active={active} onClick={onClick} type="button">
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ChatView({
  isWorking,
  messages
}: {
  isWorking: boolean;
  messages: Message[];
}) {
  return (
    <div className="messageList">
      {messages.map(message => (
        <article className="messageItem" data-role={message.role} key={message.id}>
          {message.role === "event" ? (
            <div className="eventMarker" aria-hidden="true" />
          ) : null}
          <div className="messageBubble">
            {message.meta ? <small>{message.meta}</small> : null}
            <p>{message.text}</p>
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
  );
}

function ApprovalView({ approvals }: { approvals: Approval[] }) {
  return (
    <div className="approvalList">
      {approvals.map(approval => (
        <article className="approvalCard" data-risk={approval.risk} key={approval.id}>
          <div>
            <small>{approval.risk} risk</small>
            <h2>{approval.title}</h2>
            <p>{approval.detail}</p>
          </div>
          <div className="approvalActions">
            <button className="secondaryButton" type="button">
              <X size={15} />
              Decline
            </button>
            <button className="primaryButton" type="button">
              <Check size={15} />
              Approve
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function DiffView({ lines }: { lines: string[] }) {
  return (
    <pre className="diffPanel" aria-label="Current diff">
      <code>
        {lines.map((line, index) => (
          <span className="diffLine" data-kind={diffKind(line)} key={`${index}-${line}`}>
            {line}
            {"\n"}
          </span>
        ))}
      </code>
    </pre>
  );
}

function diffKind(line: string): "add" | "remove" | "hunk" | "meta" | "context" {
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
    line.startsWith("---") ||
    line.startsWith("+++") ||
    line.startsWith("new file")
  ) {
    return "meta";
  }
  return "context";
}
