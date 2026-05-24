# Codex Desktop and Mobile App Plan

## 1. Goal

Build a desktop app similar to the Codex desktop experience, backed by the local Codex CLI runtime, and later add a mobile app that can remotely connect to the desktop app from anywhere.

The long-term product shape:

- Desktop app: local Codex runtime and full workspace/session experience.
- Mobile app: remote Codex control UI with similar interaction flow.
- Relay service: account, device pairing, online presence, encrypted message relay, and push notifications.

Core principle:

```text
Codex runs on the user's desktop machine.
The desktop app owns local workspaces and sessions.
The mobile app remotely controls the desktop app.
The relay server handles connection, authentication, and forwarding.
```

## 2. High-Level Architecture

```text
Desktop App
  - UI Layer
  - Desktop Gateway
  - Codex Adapter
      - codex app-server
  - Workspace Manager
  - Session Store
  - Remote Connector
          |
          v
Relay Server
          ^
          |
Mobile App
  - Chat UI
  - Diff Viewer
  - Approval Center
  - Push Notifications
```

## 3. Desktop App

The desktop app is the primary runtime. It is responsible for launching and managing Codex locally.

Recommended desktop stack:

```text
React + Vite + Electron + TypeScript
```

Process boundary:

```text
React Renderer
  - Renders chat, sessions, diff, command output, and approvals.
  - Does not directly start Codex.
  - Does not directly access Node.js `fs`, `process`, or shell APIs.

Electron Preload
  - Exposes a narrow `window.codexApp` API.
  - Bridges renderer calls to Electron main through IPC.
  - Keeps `contextIsolation` enabled.

Electron Main
  - Owns local filesystem and process access.
  - Starts and supervises `codex app-server`.
  - Maintains the Codex WebSocket connection.
  - Manages sessions, workspaces, approvals, and remote gateway state.

Codex App Server
  - Runs locally on `127.0.0.1`.
  - Is only reachable from Electron main.
  - Is never exposed directly to the mobile app or relay server.
```

Renderer-to-main flow:

```text
React UI
  -> window.codexApp.startThread()
  -> preload IPC bridge
  -> Electron main
  -> CodexAdapter
  -> codex app-server
```

Main modules:

- `CodexAdapter`
  - Start `codex app-server`.
  - Call `initialize`.
  - Call `thread/start`.
  - Call `turn/start`.
  - Listen to Codex events.
  - Handle approval requests.

- `SessionManager`
  - Manage thread list.
  - Resume, fork, and archive sessions.
  - Store local session metadata.
  - Track the active turn.

- `WorkspaceManager`
  - Select project directories.
  - Detect git status.
  - Manage runtime workspace roots.
  - Restrict accessible directories.

- `ApprovalManager`
  - Show command approval requests.
  - Show file change approval requests.
  - Support `accept`, `decline`, `cancel`, and `acceptForSession`.

- `RemoteGateway`
  - Expose a stable app-owned protocol to mobile clients.
  - Do not expose Codex app-server directly to mobile.
  - Handle permissions, device identity, and message forwarding.

Suggested desktop gateway API:

```ts
startSession(workspaceId, options)
sendMessage(threadId, text, attachments)
interruptTurn(threadId, turnId)
approveRequest(requestId, decision)
listSessions(workspaceId)
readSession(threadId)
listWorkspaces()
readDiff(threadId, turnId)
```

First-version desktop layout:

```text
Left sidebar:
  - Workspace list
  - Session list

Main area:
  - Chat transcript
  - Streaming assistant output
  - User composer

Right inspector:
  - Plan
  - Diff
  - Command output
  - Approval requests
```

Minimum local desktop feature set:

- Choose a project directory.
- Create a Codex thread.
- Send messages to the same thread.
- Stream assistant output.
- Show command execution output.
- Show file diffs.
- Show approval prompts.
- Interrupt the current turn.

Recommended UI libraries:

```text
State: Zustand
Routing: optional for the first version
Diff: Monaco Editor, react-diff-viewer, or a custom unified diff view
Terminal output: xterm.js or a purpose-built command output panel
Base components: Radix UI or shadcn/ui
Icons: lucide-react
Packaging: electron-builder
```

Security defaults:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true where possible
All privileged APIs go through preload IPC
Renderer never receives raw filesystem authority
```

## 4. Mobile App

The mobile app should not run Codex. It should be a remote UI for the desktop runtime.

Core screens:

- Device list
- Workspace list
- Session list
- Chat view
- Command output view
- Diff viewer
- Approval center
- Notification center

Core abilities:

- Send messages.
- View streamed assistant output.
- View command execution status.
- View diffs.
- Approve or decline commands and file changes.
- Interrupt the current turn.
- Receive push notifications when approval is needed.

Remote mobile mode should use more conservative permissions than local desktop mode:

```text
Local desktop: configurable by the user.
Remote mobile: approval required by default.
Dangerous commands: always require confirmation.
Writes outside the workspace: denied by default.
```

## 5. Relay Server

The first production relay should only relay messages. It should not run Codex or hold source code.

Relay responsibilities:

- User accounts.
- Device registration.
- Desktop online status.
- Mobile-to-desktop pairing.
- WebSocket relay.
- Push notifications.
- Subscription and billing.
- Basic audit metadata.

The relay should not store by default:

- Source code content.
- Full command output.
- Full Codex session content.
- OpenAI tokens.
- Full local file paths, unless explicitly allowed by the user.

Recommended message flow:

```text
Desktop App --WebSocket--> Relay Server
Mobile App  --WebSocket--> Relay Server

Mobile -> Relay -> Desktop
Desktop -> Relay -> Mobile
```

Long term, add end-to-end encryption:

```text
Mobile encrypts payload for Desktop.
Relay only sees deviceId, messageType, and timestamp.
Desktop decrypts and executes.
```

## 6. Codex Integration

Use `codex app-server`, not `codex exec`, because the product needs persistent interactive sessions.

Start app-server:

```bash
codex app-server --listen ws://127.0.0.1:<port>
```

Initialize:

```json
{
  "method": "initialize",
  "id": 1,
  "params": {
    "clientInfo": {
      "name": "your-desktop-app",
      "title": "Your Desktop App",
      "version": "0.1.0"
    },
    "capabilities": {
      "experimentalApi": true,
      "requestAttestation": false
    }
  }
}
```

Create a session:

```json
{
  "method": "thread/start",
  "id": 2,
  "params": {
    "cwd": "/project/path",
    "experimentalRawEvents": false,
    "persistExtendedHistory": false
  }
}
```

Send a user message:

```json
{
  "method": "turn/start",
  "id": 3,
  "params": {
    "threadId": "thread-id",
    "input": [
      {
        "type": "text",
        "text": "Implement this feature",
        "text_elements": []
      }
    ]
  }
}
```

Important events to render:

```text
thread/started
turn/started
item/agentMessage/delta
item/reasoning/summaryTextDelta
item/commandExecution/outputDelta
item/fileChange/patchUpdated
turn/diff/updated
turn/plan/updated
turn/completed
```

Approval request events:

```text
item/commandExecution/requestApproval
item/fileChange/requestApproval
item/permissions/requestApproval
```

## 7. App-Owned Gateway Protocol

The mobile app should not depend directly on the Codex app-server protocol. The desktop app should expose a stable gateway protocol.

Example client-to-desktop messages:

```ts
type ClientToDesktop =
  | { type: "session.start"; workspaceId: string; prompt?: string }
  | { type: "turn.start"; threadId: string; text: string }
  | { type: "turn.interrupt"; threadId: string; turnId: string }
  | { type: "approval.resolve"; requestId: string; decision: "accept" | "decline" | "cancel" }
  | { type: "sessions.list"; workspaceId?: string }
  | { type: "thread.read"; threadId: string };
```

Example desktop-to-client messages:

```ts
type DesktopToClient =
  | { type: "thread.started"; thread: ThreadView }
  | { type: "turn.started"; turn: TurnView }
  | { type: "message.delta"; threadId: string; turnId: string; text: string }
  | { type: "command.delta"; commandId: string; stream: "stdout" | "stderr"; text: string }
  | { type: "diff.updated"; threadId: string; turnId: string; summary: DiffSummary }
  | { type: "approval.requested"; request: ApprovalView }
  | { type: "turn.completed"; turn: TurnView }
  | { type: "error"; message: string };
```

## 8. Security Model

Mobile remote control is equivalent to controlling a local coding agent that can edit files and run commands. Security must be designed from the first version.

Device pairing:

```text
Desktop generates a one-time pairing code or QR code.
Mobile scans the code.
Relay establishes device trust.
Desktop asks the user for final confirmation.
```

Remote access controls:

- Every mobile device has its own device key.
- The desktop app can revoke any device at any time.
- Mobile connections require user login.
- No work can be performed if the desktop app is offline.
- High-risk actions require explicit confirmation.

Approval policy:

```text
Read-only operations: can be automatic.
Normal writes inside workspace: configurable.
Shell commands: require approval by default.
Network access: require approval by default.
Dangerous commands: forced approval.
Cross-directory writes: denied by default.
```

Audit log fields:

```text
timestamp
deviceId
threadId
actionType
approvalDecision
commandSummary
workspaceId
```

## 9. Technology Choices

Fastest first version:

```text
Desktop: React + Vite + Electron + TypeScript
Mobile: Expo / React Native
Relay: Node.js
Realtime: WebSocket
DB: Postgres
Presence/cache: Redis
Push: APNs + FCM
Encryption: WebCrypto or libsodium
Shared protocol: TypeScript monorepo
```

Alternative if desktop size and native integration matter more:

```text
Desktop: Tauri
Mobile: React Native
Relay: Node.js, Go, or Rust
```

Recommended repository layout:

```text
apps/
  desktop/
    electron/
      main.ts
      preload.ts
      codex-adapter.ts
      workspace-manager.ts
      session-manager.ts
      approval-manager.ts
      remote-gateway.ts
    src/
      app/
      components/
      features/
        chat/
        sessions/
        workspace/
        approvals/
        diff/
        command-output/
      protocol/
    package.json
    vite.config.ts

  mobile/
    src/
      app/
      features/
        devices/
        sessions/
        chat/
        approvals/
        diff/

  relay/
    src/
      auth/
      devices/
      relay/
      presence/
      push/

packages/
  protocol/
    src/
      desktop-gateway.ts
      relay.ts
      events.ts

  codex-adapter/
    src/
      client.ts
      protocol.ts
      process.ts

  shared/
    src/
      ids.ts
      errors.ts
      logging.ts
```

The desktop renderer should depend on `packages/protocol`, but not on `packages/codex-adapter` directly. The Codex adapter should run behind Electron main so future mobile and relay work can reuse the same app-owned protocol without inheriting Codex app-server protocol churn.

## 10. Milestones

### P0: Codex Adapter Prototype

- Connect to `codex app-server`.
- Run `initialize`.
- Run `thread/start`.
- Run `turn/start`.
- Receive assistant deltas.
- Handle approval requests.
- Interrupt a turn.

### P1: Local Desktop App

- React + Vite + Electron shell.
- Secure preload IPC bridge.
- Workspace selection.
- Session list.
- Chat view.
- Command output.
- Diff viewer.
- Approval center.

### P2: Desktop Gateway

- Stable app-owned protocol.
- Local WebSocket gateway.
- Decouple UI from Codex protocol.

### P3: Mobile LAN Prototype

- Mobile connects to desktop gateway on the same network.
- Send messages.
- View streamed output.
- Approve requests.
- Validate mobile interaction quality.

### P4: Relay Server

- Login.
- Device pairing.
- Online presence.
- WebSocket relay.
- Push notifications.

### P5: Security and Commercialization

- End-to-end encryption.
- Subscription.
- Multi-device management.
- Audit logs.
- Organization/team policies.

## 11. Main Risks

- `codex app-server` is currently experimental, so the protocol may change.
- Remote mobile approval creates real security risk.
- Relay privacy and encryption need careful design.
- Shell, sandbox, and file permission behavior differs across platforms.
- Cloud execution would be much more complex and should be postponed.

## 12. Recommended First Step

Build a standalone `codex-adapter` prototype before building the UI.

The adapter should expose:

```ts
connect()
initialize()
startThread(cwd)
startTurn(threadId, text)
onEvent(callback)
resolveApproval(requestId, decision)
interruptTurn(threadId, turnId)
```

Once this adapter works reliably, the desktop app, mobile app, and relay service can be built around it.
