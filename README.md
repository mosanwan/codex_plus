# CodeP Desktop and Mobile

Prototype for a Codex-like desktop app with a future mobile remote-control client.

The current implementation contains:

- `packages/codex-adapter`: local adapter for `codex app-server`.
- `apps/desktop`: React + Vite + Electron desktop shell.
- `apps/mobile`: React + Vite + Capacitor Android shell.
- `codex-desktop-mobile-plan.md`: product and architecture plan.

## Commands

Install dependencies:

```bash
npm install
```

If Electron binary download times out, use a mirror:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm rebuild electron
```

Validate the workspace:

```bash
npm run typecheck
npm run build
npm run probe:adapter
```

Run a real Codex turn through the adapter:

```bash
npm run probe:adapter -- --turn "Say hello briefly."
```

Start the built desktop app:

```bash
npm run start -w @codep/desktop
```

In Linux containers where Electron's SUID sandbox is not configured, use:

```bash
npm run start:no-sandbox -w @codep/desktop
```

Start the mobile web shell:

```bash
npm run dev -w @codep/mobile
```

Build and sync the Android app:

```bash
npm run build -w @codep/mobile
npm run cap:sync -w @codep/mobile
```

Open the Android project in Android Studio:

```bash
npm run android:open -w @codep/mobile
```

For CLI Android builds on this machine, Android Studio's bundled JBR works:

```bash
cd apps/mobile/android
JAVA_HOME=/snap/android-studio/209/jbr ./gradlew assembleDebug
```

If Gradle cannot find the SDK, create `apps/mobile/android/local.properties`
with:

```properties
sdk.dir=/home/three/Android/Sdk
```

## Current Status

P0 is functional:

- Starts `codex app-server`.
- Connects over local WebSocket.
- Runs `initialize`.
- Creates an ephemeral thread.
- Starts a real turn.
- Receives assistant deltas and turn completion.
- Emits normalized adapter events for the future UI/gateway layer.

P1 has a first desktop shell:

- Secure Electron main/preload/renderer split.
- Workspace picker IPC.
- Codex connect IPC.
- Thread start IPC.
- Turn start IPC.
- Turn interrupt IPC.
- Approval resolution IPC.
- React workbench with workspace, session, chat, and tabbed inspector panes.
- Inspector tabs for plan, command output, diff, approvals, and raw events.
- Auto-connects to local Codex when the app opens.
- Remembers the last workspace locally.
- Attempts to resume the last session for a remembered workspace, falling back to a new session.
- Keeps stop and approval actions directly above the composer.
- Lists existing Codex sessions for the selected workspace with `thread/list`.
- Supports clicking an existing session to `thread/resume`.
- Provides an explicit `New` session action in the sidebar.
- Loads resumed session transcript from `thread.turns`.
- Sends with Enter and inserts newlines with Shift+Enter.
- Keeps Enter as send while Codex is working; Escape interrupts the active turn.

P2 has an Android app shell:

- React + Vite mobile UI.
- Capacitor Android project under `apps/mobile/android`.
- Remote-control oriented screens for device status, sessions, chat, approvals, and diff.
- Mobile composer behavior aligned with desktop: Enter sends, Stop is explicit.
- Debug APK builds with the local Android SDK and Android Studio JBR.
