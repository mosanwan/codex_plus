import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  shell,
  type OpenDialogOptions
} from "electron";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, open as openFile, readdir, readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  CodexAdapter,
  type CodexAdapterEvent,
  type InitializeResponse,
  type JsonObject,
  type ReasoningEffort,
  type SkillMetadata,
  type UserInput
} from "@codep/codex-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

if (process.platform === "linux") {
  app.setName("Codex+");
  if (process.env.CODEX_PLUS_DISABLE_GPU !== "0") {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch("disable-gpu");
  }
  const ozonePlatform =
    process.env.CODEX_PLUS_OZONE_PLATFORM ??
    (process.env.XDG_SESSION_TYPE === "wayland" ? "wayland" : "x11");
  app.commandLine.appendSwitch("ozone-platform", ozonePlatform);
  app.commandLine.appendSwitch(
    "enable-features",
    process.env.CODEX_PLUS_ENABLE_FEATURES ?? "WaylandWindowDecorations"
  );
  if (ozonePlatform !== "x11" && !process.env.CODEX_PLUS_DISABLE_WAYLAND_IME) {
    app.commandLine.appendSwitch("enable-wayland-ime");
    app.commandLine.appendSwitch(
      "wayland-text-input-version",
      process.env.CODEX_PLUS_WAYLAND_TEXT_INPUT_VERSION ?? "3"
    );
  }
  if (process.env.CODEX_PLUS_GTK_VERSION) {
    app.commandLine.appendSwitch("gtk-version", process.env.CODEX_PLUS_GTK_VERSION);
  }
}

let mainWindow: BrowserWindow | null = null;
let adapter: CodexAdapter | null = null;
let connectPromise: Promise<InitializeResponse> | null = null;
let initializeResponse: InitializeResponse | null = null;
let userSettingsPromise: Promise<UserSettings> | null = null;
let periodicTasksLoadedPromise: Promise<void> | null = null;
let periodicTaskTimer: NodeJS.Timeout | null = null;
let periodicTaskTickPromise: Promise<void> | null = null;
let periodicTasks: PeriodicTask[] = [];
const activeTurnByThread = new Map<string, string>();

interface UserSettings {
  codexCommandPath?: string;
}

type PeriodicTaskSessionMode = "existing" | "create_once";
type PeriodicTaskStatus = "idle" | "waiting" | "running" | "paused" | "error";
type PeriodicTaskPermissionMode = "default" | "auto-review" | "full-access";
type PeriodicTaskTrigger = "interval" | "schedule";
type PeriodicTaskScheduleFrequency = "daily" | "weekly";

interface PeriodicTask {
  id: string;
  name: string;
  enabled: boolean;
  workspace: string;
  sessionMode: PeriodicTaskSessionMode;
  sessionId?: string;
  prompt: string;
  trigger: PeriodicTaskTrigger;
  intervalMs: number;
  scheduleFrequency: PeriodicTaskScheduleFrequency;
  scheduleTime: string;
  scheduleWeekdays: number[];
  model?: string;
  effort?: ReasoningEffort | null;
  permissionMode: PeriodicTaskPermissionMode;
  nextRunAt?: number;
  lastRunAt?: number;
  lastCompletedAt?: number;
  lastError?: string;
  status: PeriodicTaskStatus;
  activeTurnId?: string;
  createdAt: number;
  updatedAt: number;
}

interface PeriodicTaskInput {
  name: string;
  enabled?: boolean;
  workspace: string;
  sessionMode: PeriodicTaskSessionMode;
  sessionId?: string;
  prompt: string;
  trigger?: PeriodicTaskTrigger;
  intervalMs: number;
  scheduleFrequency?: PeriodicTaskScheduleFrequency;
  scheduleTime?: string;
  scheduleWeekdays?: number[];
  model?: string;
  effort?: ReasoningEffort | null;
  permissionMode?: PeriodicTaskPermissionMode;
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

interface RemoteAttachmentInput {
  kind: "image";
  name: string;
  mimeType: string;
  dataUrl: string;
}

interface ComposerSuggestion {
  id: string;
  type: "file" | "skill";
  label: string;
  name: string;
  detail?: string;
  insertText: string;
  path?: string;
}

interface WorkspaceFilePreview {
  path: string;
  relativePath: string;
  name: string;
  content: string;
  size: number;
  truncated: boolean;
}

interface NotificationSoundFile {
  path: string;
  url: string;
  name: string;
}

interface DesktopUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloadUrl?: string;
  releaseNotes?: string;
  checkedAt: number;
}

interface UpdateManifest {
  version?: unknown;
  latestVersion?: unknown;
  tagName?: unknown;
  releaseNotes?: unknown;
  notes?: unknown;
  downloadUrl?: unknown;
  downloads?: unknown;
}

const DEFAULT_UPDATE_MANIFEST_URL =
  "https://codex-bridge.three.ink/codex-plus/desktop/latest.json";
const UPDATE_CHECK_TIMEOUT_MS = 8000;

function createWindow(): void {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1280, primaryWorkArea.width);
  const height = Math.min(820, primaryWorkArea.height);
  mainWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(primaryWorkArea.x + (primaryWorkArea.width - width) / 2),
    y: Math.round(primaryWorkArea.y + (primaryWorkArea.height - height) / 2),
    minWidth: 960,
    minHeight: 640,
    title: "Codex+ Desktop",
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f6f7f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  logDesktopLifecycle("window-created");
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setMenu(null);

  mainWindow.once("ready-to-show", () => {
    logDesktopLifecycle("window-ready-to-show");
    presentMainWindow();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    logDesktopLifecycle("window-did-finish-load");
    presentMainWindow();
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    logDesktopLifecycle(
      `window-did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`
    );
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logDesktopLifecycle(`render-process-gone ${details.reason} ${details.exitCode}`);
  });

  mainWindow.on("unresponsive", () => {
    logDesktopLifecycle("window-unresponsive");
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    logDesktopLifecycle("window-closed");
    mainWindow = null;
  });
}

function logDesktopLifecycle(message: string): void {
  if (process.env.CODEX_PLUS_DEBUG_WINDOW !== "1") {
    return;
  }
  console.log(`[codex-plus-window] ${message}`);
}

function presentMainWindow(): void {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.focus();
  mainWindow.moveTop();
  app.focus({ steal: true });
  setTimeout(() => {
    mainWindow?.setAlwaysOnTop(false);
  }, 6000);
  logDesktopLifecycle(
    `window-presented visible=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} bounds=${JSON.stringify(mainWindow.getBounds())}`
  );
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (periodicTaskTimer) {
    clearTimeout(periodicTaskTimer);
    periodicTaskTimer = null;
  }
  void adapter?.disconnect();
});

async function connectCodexAdapter(): Promise<InitializeResponse> {
  const settings = await loadUserSettings();

  try {
    return await connectWithCodexCommand(settings.codexCommandPath);
  } catch (error) {
    await resetAdapter();

    if (!isCodexCommandNotFoundError(error)) {
      throw error;
    }

    const detectedPath = await detectCodexCommandPath();
    if (detectedPath) {
      await saveUserSettings({
        ...settings,
        codexCommandPath: detectedPath
      });
      return connectWithCodexCommand(detectedPath);
    }

    const selectedPath = await promptForCodexCommand();
    if (!selectedPath) {
      throw error;
    }

    await saveUserSettings({
      ...settings,
      codexCommandPath: selectedPath
    });

    return connectWithCodexCommand(selectedPath);
  }
}

async function connectWithCodexCommand(
  codexCommandPath?: string
): Promise<InitializeResponse> {
  if (!adapter) {
    adapter = createCodexAdapter(codexCommandPath);
  }

  return adapter.connect();
}

function createCodexAdapter(codexCommandPath?: string): CodexAdapter {
  const nextAdapter = new CodexAdapter({
    codexCommand: codexCommandPath,
    clientInfo: {
      name: "codep-desktop",
      title: "Codex+ Desktop",
      version: app.getVersion()
    }
  });

  nextAdapter.on("event", event => {
    handlePeriodicTaskCodexEvent(event);
    sendCodexEvent(event);
  });
  nextAdapter.on("error", error => {
    sendCodexEvent({
      type: "raw.notification",
      method: "adapter/error",
      raw: {
        method: "adapter/error",
        params: { message: error.message }
      }
    });
  });

  return nextAdapter;
}

async function resetAdapter(): Promise<void> {
  await adapter?.disconnect();
  adapter = null;
  initializeResponse = null;
}

function isCodexCommandNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Failed to start codex app-server") &&
    (message.includes("ENOENT") ||
      message.includes("not found") ||
      message.includes("no such file or directory"))
  );
}

function isUnknownStatusMethodError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("unknown variant `status`");
}

async function promptForCodexCommand(): Promise<string | null> {
  const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const options: OpenDialogOptions = {
    title: "Locate Codex CLI",
    message:
      "Codex+ could not find the codex command. Choose the codex executable to continue.",
    buttonLabel: "Use Codex CLI",
    properties: ["openFile"],
    defaultPath: await defaultCodexCommandDialogPath()
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const selectedPath = result.canceled ? null : result.filePaths[0] ?? null;
  if (!selectedPath) {
    return null;
  }

  try {
    await access(selectedPath, fsConstants.X_OK);
    return selectedPath;
  } catch {
    const messageOptions = {
      type: "error",
      title: "Codex CLI is not executable",
      message: "The selected file cannot be run as a command.",
      detail: selectedPath
    } as const;
    if (window) {
      await dialog.showMessageBox(window, messageOptions);
    } else {
      await dialog.showMessageBox(messageOptions);
    }
    return null;
  }
}

async function defaultCodexCommandDialogPath(): Promise<string | undefined> {
  for (const candidate of commonCodexCommandPaths()) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next common installation path.
    }
  }
  return homedir();
}

async function detectCodexCommandPath(): Promise<string | null> {
  for (const candidate of commonCodexCommandPaths()) {
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }

  const shellPath = await detectCodexCommandPathFromShell();
  if (shellPath && await isExecutableFile(shellPath)) {
    return shellPath;
  }

  return null;
}

async function detectCodexCommandPathFromShell(): Promise<string | null> {
  if (process.platform === "win32") {
    return detectCodexCommandPathFromWindows();
  }

  const shells = Array.from(
    new Set([process.env.SHELL, "/bin/zsh", "/bin/bash"].filter(Boolean))
  ) as string[];

  for (const shell of shells) {
    try {
      const { stdout } = await execFileAsync(shell, ["-lc", "command -v codex"], {
        encoding: "utf8",
        timeout: 2_000
      });
      const firstLine = stdout.split("\n").map(line => line.trim()).find(Boolean);
      if (firstLine && path.isAbsolute(firstLine)) {
        return firstLine;
      }
    } catch {
      // Try the next available shell.
    }
  }

  return null;
}

async function detectCodexCommandPathFromWindows(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("where.exe", ["codex"], {
      encoding: "utf8",
      timeout: 2_000
    });
    const firstLine = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);
    return firstLine ?? null;
  } catch {
    return null;
  }
}

function commonCodexCommandPaths(): string[] {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    const appData = process.env.APPDATA;
    const userProfile = process.env.USERPROFILE || homedir();
    return [
      ...(appData ? [path.join(appData, "npm", "codex.cmd")] : []),
      ...(appData ? [path.join(appData, "npm", "codex.exe")] : []),
      ...(localAppData
        ? [path.join(localAppData, "pnpm", "codex.cmd")]
        : []),
      path.join(userProfile, ".yarn", "bin", "codex.cmd"),
      path.join(userProfile, ".local", "bin", "codex.exe")
    ];
  }

  return [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(homedir(), ".local", "bin", "codex"),
    path.join(homedir(), ".npm-global", "bin", "codex")
  ];
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadUserSettings(): Promise<UserSettings> {
  if (!userSettingsPromise) {
    userSettingsPromise = readUserSettings();
  }
  return userSettingsPromise;
}

async function readUserSettings(): Promise<UserSettings> {
  try {
    const raw = await readFile(userSettingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return typeof parsed.codexCommandPath === "string"
      ? { codexCommandPath: parsed.codexCommandPath }
      : {};
  } catch {
    return {};
  }
}

async function saveUserSettings(settings: UserSettings): Promise<void> {
  await mkdir(path.dirname(userSettingsPath()), { recursive: true });
  await writeFile(userSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  userSettingsPromise = Promise.resolve(settings);
}

function userSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function registerIpcHandlers(): void {
  ipcMain.handle("workspace:choose", async () => {
    const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options: OpenDialogOptions = {
      title: "Choose workspace",
      properties: ["openDirectory", "createDirectory"]
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("attachment:clipboard", async () => clipboardAttachments());
  ipcMain.handle("attachment:choose", async () => chooseAttachmentFiles());
  ipcMain.handle("notification:sound:choose", async () => chooseNotificationSoundFile());
  ipcMain.handle("app:update:check", async () => checkForDesktopUpdate());
  ipcMain.handle("app:update:open-download", async (_event, url: string) => {
    if (!isHttpUrl(url)) {
      throw new Error("Invalid update download URL.");
    }
    await shell.openExternal(url);
  });
  ipcMain.handle(
    "attachment:remote",
    async (_event, attachments: RemoteAttachmentInput[]) =>
      saveRemoteAttachments(attachments)
  );
  ipcMain.handle(
    "composer:files:search",
    async (_event, options: { cwd: string; query?: string; limit?: number }) =>
      searchWorkspaceFiles(options)
  );
  ipcMain.handle(
    "workspace:file:preview",
    async (_event, options: { cwd: string; path: string; maxBytes?: number }) =>
      previewWorkspaceFile(options)
  );
  ipcMain.handle(
    "composer:skills:search",
    async (_event, options: { cwd?: string; query?: string; limit?: number; forceReload?: boolean } = {}) =>
      searchCodexSkills(options)
  );

  ipcMain.handle("codex:connect", async () => {
    if (initializeResponse) {
      return initializeResponse;
    }

    if (connectPromise) {
      return connectPromise;
    }

    connectPromise = connectCodexAdapter()
      .then(response => {
        initializeResponse = response;
        return response;
      })
      .finally(() => {
        connectPromise = null;
      });

    return connectPromise;
  });

  ipcMain.handle("codex:disconnect", async () => {
    await adapter?.disconnect();
    adapter = null;
    connectPromise = null;
    initializeResponse = null;
  });

  ipcMain.handle(
    "codex:thread:start",
    async (
      _event,
      options: {
        cwd: string;
        model?: string;
        serviceTier?: string | null;
        effort?: ReasoningEffort | null;
        approvalPolicy?: string;
        approvalsReviewer?: string;
        permissionProfile?: string;
        sandbox?: string;
      }
    ) => {
      if (!adapter) {
        throw new Error("Codex adapter is not connected");
      }
      return adapter.startThread({
        cwd: options.cwd,
        model: options.model,
        serviceTier: options.serviceTier,
        effort: options.effort,
        approvalPolicy: options.approvalPolicy,
        approvalsReviewer: options.approvalsReviewer,
        permissionProfile: options.permissionProfile,
        sandbox: options.sandbox
      });
    }
  );

  ipcMain.handle("codex:thread:list", async (_event, options: { cwd: string }) => {
    if (!adapter) {
      throw new Error("Codex adapter is not connected");
    }
    return adapter.listThreads({
      cwd: options.cwd,
      limit: 50,
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: false
    });
  });

  ipcMain.handle(
    "codex:model:list",
    async (_event, options: { includeHidden?: boolean; limit?: number } = {}) => {
      if (!adapter) {
        throw new Error("Codex adapter is not connected");
      }
      return adapter.listModels({
        includeHidden: options.includeHidden,
        limit: options.limit
      });
    }
  );

  ipcMain.handle("codex:status", async () => {
    if (!adapter) {
      throw new Error("Codex adapter is not connected");
    }
    try {
      return await adapter.getStatus();
    } catch (error) {
      if (isUnknownStatusMethodError(error)) {
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle(
    "codex:thread:rename",
    async (_event, options: { threadId: string; name: string }) => {
      if (!adapter) {
        throw new Error("Codex adapter is not connected");
      }
      return adapter.setThreadName(options.threadId, options.name);
    }
  );

  ipcMain.handle(
    "codex:thread:resume",
    async (
      _event,
      options: {
        threadId: string;
        cwd: string;
        model?: string;
        serviceTier?: string | null;
        effort?: ReasoningEffort | null;
        approvalPolicy?: string;
        approvalsReviewer?: string;
        permissionProfile?: string;
        sandbox?: string;
      }
    ) => {
      if (!adapter) {
        throw new Error("Codex adapter is not connected");
      }
      return adapter.resumeThread(options.threadId, {
        cwd: options.cwd,
        model: options.model,
        serviceTier: options.serviceTier,
        effort: options.effort,
        approvalPolicy: options.approvalPolicy,
        approvalsReviewer: options.approvalsReviewer,
        permissionProfile: options.permissionProfile,
        sandbox: options.sandbox,
        excludeTurns: false
      });
    }
  );

  ipcMain.handle(
    "codex:turn:start",
    async (
      _event,
      options: {
        threadId: string;
        text: string;
        input?: UserInput[];
        model?: string;
        serviceTier?: string | null;
        effort?: ReasoningEffort | null;
        approvalPolicy?: string;
        approvalsReviewer?: string;
        permissionProfile?: string;
        sandboxPolicy?: JsonObject;
      }
    ) => {
      if (!adapter) {
        throw new Error("Codex adapter is not connected");
      }
      if (options.input) {
        return adapter.startTurnWithInput(options.threadId, options.input, {
          model: options.model,
          serviceTier: options.serviceTier,
          effort: options.effort,
          approvalPolicy: options.approvalPolicy,
          approvalsReviewer: options.approvalsReviewer,
          permissionProfile: options.permissionProfile,
          sandboxPolicy: options.sandboxPolicy
        });
      }
      return adapter.startTurn(options.threadId, options.text, {
        model: options.model,
        serviceTier: options.serviceTier,
        effort: options.effort,
        approvalPolicy: options.approvalPolicy,
        approvalsReviewer: options.approvalsReviewer,
        permissionProfile: options.permissionProfile,
        sandboxPolicy: options.sandboxPolicy
      });
    }
  );

  ipcMain.handle(
    "codex:turn:interrupt",
    async (_event, options: { threadId: string; turnId: string }) => {
      if (!adapter) {
        throw new Error("Codex adapter is not connected");
      }
      return adapter.interruptTurn(options.threadId, options.turnId);
    }
  );

  ipcMain.handle(
    "codex:approval:resolve",
    async (
      _event,
      options: { requestId: string | number; decision: "accept" | "decline" | "cancel" }
    ) => {
      if (!adapter) {
        throw new Error("Codex adapter is not connected");
      }
      adapter.resolveServerRequest(options.requestId, {
        decision: options.decision
      });
    }
  );

  ipcMain.handle("periodic-tasks:list", async () => {
    await loadPeriodicTasks();
    return periodicTasks;
  });

  ipcMain.handle(
    "periodic-tasks:create",
    async (_event, input: PeriodicTaskInput) => createPeriodicTask(input)
  );

  ipcMain.handle(
    "periodic-tasks:update",
    async (_event, options: { taskId: string; patch: Partial<PeriodicTaskInput> }) =>
      updatePeriodicTask(options.taskId, options.patch)
  );

  ipcMain.handle(
    "periodic-tasks:delete",
    async (_event, options: { taskId: string }) => deletePeriodicTask(options.taskId)
  );

  ipcMain.handle(
    "periodic-tasks:run-now",
    async (_event, options: { taskId: string }) => runPeriodicTaskNow(options.taskId)
  );
}

async function checkForDesktopUpdate(): Promise<DesktopUpdateInfo> {
  const currentVersion = app.getVersion();
  const checkedAt = Date.now();
  const manifestUrl = updateManifestUrl();

  if (!manifestUrl) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      checkedAt
    };
  }

  const manifest = await fetchUpdateManifest(manifestUrl).catch(() => null);
  if (!manifest) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      checkedAt
    };
  }
  const latestVersion =
    stringOrUndefined(manifest.latestVersion) ??
    stringOrUndefined(manifest.version) ??
    stringOrUndefined(manifest.tagName) ??
    null;

  if (!latestVersion) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      checkedAt
    };
  }

  const downloadUrl = selectDownloadUrl(manifest);
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    downloadUrl,
    releaseNotes:
      stringOrUndefined(manifest.releaseNotes) ?? stringOrUndefined(manifest.notes),
    checkedAt
  };
}

function updateManifestUrl(): string | null {
  if (process.env.CODEX_PLUS_DISABLE_UPDATE_CHECK === "1") {
    return null;
  }

  const configured = process.env.CODEX_PLUS_UPDATE_MANIFEST_URL?.trim();
  return configured || DEFAULT_UPDATE_MANIFEST_URL;
}

async function fetchUpdateManifest(url: string): Promise<UpdateManifest> {
  if (!isHttpUrl(url)) {
    throw new Error("Invalid update manifest URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Update check failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    if (!contentType.includes("json")) {
      throw new Error("Update manifest response is not JSON.");
    }

    const payload = JSON.parse(text) as unknown;
    const manifest = asRecord(payload);
    return manifest as UpdateManifest;
  } finally {
    clearTimeout(timeout);
  }
}

function selectDownloadUrl(manifest: UpdateManifest): string | undefined {
  const directUrl = stringOrUndefined(manifest.downloadUrl);
  if (directUrl && isHttpUrl(directUrl)) {
    return directUrl;
  }

  const downloads = asRecord(manifest.downloads);
  const platformKeys = updateDownloadKeys();
  for (const key of platformKeys) {
    const candidate = downloadUrlFromValue(downloads[key]);
    if (candidate && isHttpUrl(candidate)) {
      return candidate;
    }
  }

  for (const value of Object.values(downloads)) {
    const candidate = downloadUrlFromValue(value);
    if (candidate && isHttpUrl(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function updateDownloadKeys(): string[] {
  const platform = process.platform;
  const arch = process.arch;
  const aliases = new Set<string>([
    `${platform}-${arch}`,
    `${platform}_${arch}`,
    platform
  ]);

  if (platform === "darwin") {
    aliases.add(`macos-${arch}`);
    aliases.add(`macos_${arch}`);
    aliases.add("macos");
  }

  if (platform === "win32") {
    aliases.add(`windows-${arch}`);
    aliases.add(`windows_${arch}`);
    aliases.add("windows");
  }

  if (platform === "linux") {
    const debArchName = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : arch;
    aliases.add(`linux-${debArchName}`);
    aliases.add(`linux_${debArchName}`);
    aliases.add(`deb-${debArchName}`);
    aliases.add(`deb_${debArchName}`);
    aliases.add("deb");
  }

  return [...aliases];
}

function downloadUrlFromValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return stringOrUndefined(asRecord(value).url);
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

function versionParts(value: string): number[] {
  return value
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map(part => Number.parseInt(part, 10))
    .filter(Number.isFinite);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function sendCodexEvent(event: CodexAdapterEvent): void {
  mainWindow?.webContents.send("codex:event", event);
}

async function ensureCodexConnected(): Promise<CodexAdapter> {
  if (!initializeResponse) {
    if (!connectPromise) {
      connectPromise = connectCodexAdapter()
        .then(response => {
          initializeResponse = response;
          return response;
        })
        .finally(() => {
          connectPromise = null;
        });
    }
    await connectPromise;
  }

  if (!adapter) {
    throw new Error("Codex adapter is not connected");
  }
  return adapter;
}

async function loadPeriodicTasks(): Promise<void> {
  if (!periodicTasksLoadedPromise) {
    periodicTasksLoadedPromise = readPeriodicTasks()
      .then(tasks => {
        periodicTasks = tasks;
        schedulePeriodicTaskTimer();
      })
      .catch(error => {
        periodicTasks = [];
        throw error;
      });
  }
  return periodicTasksLoadedPromise;
}

async function readPeriodicTasks(): Promise<PeriodicTask[]> {
  try {
    const raw = await readFile(periodicTasksPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizePeriodicTask).filter(Boolean) as PeriodicTask[];
  } catch {
    return [];
  }
}

async function savePeriodicTasks(): Promise<void> {
  await mkdir(path.dirname(periodicTasksPath()), { recursive: true });
  await writeFile(
    periodicTasksPath(),
    `${JSON.stringify(periodicTasks, null, 2)}\n`,
    "utf8"
  );
  mainWindow?.webContents.send("periodic-tasks:updated", periodicTasks);
  schedulePeriodicTaskTimer();
}

function periodicTasksPath(): string {
  return path.join(app.getPath("userData"), "periodic-tasks.json");
}

async function createPeriodicTask(input: PeriodicTaskInput): Promise<PeriodicTask> {
  await loadPeriodicTasks();
  const now = Date.now();
  const normalizedInput = normalizePeriodicTaskInput(input);
  const task: PeriodicTask = {
    ...normalizedInput,
    id: randomId(),
    enabled: input.enabled ?? true,
    nextRunAt: input.enabled === false
      ? undefined
      : nextPeriodicTaskRunAt(normalizedInput, now, true),
    status: input.enabled === false ? "paused" : "waiting",
    createdAt: now,
    updatedAt: now
  };
  periodicTasks = [task, ...periodicTasks];
  await savePeriodicTasks();
  return task;
}

async function updatePeriodicTask(
  taskId: string,
  patch: Partial<PeriodicTaskInput>
): Promise<PeriodicTask> {
  await loadPeriodicTasks();
  const task = periodicTasks.find(item => item.id === taskId);
  if (!task) {
    throw new Error("Periodic task not found");
  }

  const nextInput = normalizePeriodicTaskInput({
    name: patch.name ?? task.name,
    enabled: patch.enabled ?? task.enabled,
    workspace: patch.workspace ?? task.workspace,
    sessionMode: patch.sessionMode ?? task.sessionMode,
    sessionId: patch.sessionId ?? task.sessionId,
    prompt: patch.prompt ?? task.prompt,
    trigger: patch.trigger ?? task.trigger,
    intervalMs: patch.intervalMs ?? task.intervalMs,
    scheduleFrequency: patch.scheduleFrequency ?? task.scheduleFrequency,
    scheduleTime: patch.scheduleTime ?? task.scheduleTime,
    scheduleWeekdays: patch.scheduleWeekdays ?? task.scheduleWeekdays,
    model: patch.model ?? task.model,
    effort: patch.effort === undefined ? task.effort : patch.effort,
    permissionMode: patch.permissionMode ?? task.permissionMode
  });
  const enabled = patch.enabled ?? task.enabled;
  const now = Date.now();
  const scheduleChanged =
    patch.trigger !== undefined ||
    patch.intervalMs !== undefined ||
    patch.scheduleFrequency !== undefined ||
    patch.scheduleTime !== undefined ||
    patch.scheduleWeekdays !== undefined ||
    (patch.enabled === true && !task.enabled);
  const updated: PeriodicTask = {
    ...task,
    ...nextInput,
    enabled,
    status:
      task.status === "running"
        ? "running"
        : enabled
          ? task.status === "error"
            ? "waiting"
            : "waiting"
          : "paused",
    nextRunAt:
      task.status === "running"
        ? task.nextRunAt
        : enabled
          ? scheduleChanged
            ? nextPeriodicTaskRunAt(nextInput, now, true)
            : task.nextRunAt ?? nextPeriodicTaskRunAt(nextInput, now, true)
          : undefined,
    lastError: enabled ? undefined : task.lastError,
    updatedAt: now
  };

  periodicTasks = periodicTasks.map(item => item.id === taskId ? updated : item);
  await savePeriodicTasks();
  return updated;
}

async function deletePeriodicTask(taskId: string): Promise<void> {
  await loadPeriodicTasks();
  periodicTasks = periodicTasks.filter(item => item.id !== taskId);
  await savePeriodicTasks();
}

async function runPeriodicTaskNow(taskId: string): Promise<PeriodicTask> {
  await loadPeriodicTasks();
  const task = periodicTasks.find(item => item.id === taskId);
  if (!task) {
    throw new Error("Periodic task not found");
  }
  await runPeriodicTask(task, { manual: true });
  return periodicTasks.find(item => item.id === taskId) ?? task;
}

function schedulePeriodicTaskTimer(): void {
  if (periodicTaskTimer) {
    clearTimeout(periodicTaskTimer);
    periodicTaskTimer = null;
  }

  const now = Date.now();
  const nextRunAt = periodicTasks
    .filter(task => task.enabled && task.status !== "running")
    .map(task => task.nextRunAt ?? now)
    .reduce<number | null>((earliest, value) =>
      earliest === null || value < earliest ? value : earliest, null);

  if (nextRunAt === null) {
    return;
  }

  periodicTaskTimer = setTimeout(() => {
    periodicTaskTimer = null;
    periodicTaskTickPromise ??= runDuePeriodicTasks().finally(() => {
      periodicTaskTickPromise = null;
      schedulePeriodicTaskTimer();
    });
  }, Math.max(nextRunAt - now, 0));
}

async function runDuePeriodicTasks(): Promise<void> {
  await loadPeriodicTasks();
  const now = Date.now();
  const dueTasks = periodicTasks.filter(
    task => task.enabled && task.status !== "running" && (task.nextRunAt ?? now) <= now
  );

  for (const task of dueTasks) {
    await runPeriodicTask(task, { manual: false });
  }
}

async function runPeriodicTask(
  task: PeriodicTask,
  options: { manual: boolean }
): Promise<void> {
  const current = periodicTasks.find(item => item.id === task.id);
  if (!current) {
    return;
  }
  if (!options.manual && !current.enabled) {
    return;
  }
  if (current.status === "running") {
    return;
  }

  try {
    const codex = await ensureCodexConnected();
    const sessionId = await ensurePeriodicTaskSession(codex, current);
    const busyTurnId = activeTurnByThread.get(sessionId);
    if (busyTurnId) {
      await patchPeriodicTask(current.id, {
        status: "waiting",
        nextRunAt: Date.now() + 30_000,
        lastError: `Target session is already running turn ${busyTurnId.slice(0, 8)}.`
      });
      return;
    }

    await codex.resumeThread(sessionId, {
      cwd: current.workspace,
      ...periodicTaskPermissionOptions(current.permissionMode),
      ...periodicTaskModelOptions(current)
    }).catch(() => undefined);

    const response = await codex.startTurn(sessionId, current.prompt, {
      ...periodicTaskPermissionOptions(current.permissionMode),
      ...periodicTaskModelOptions(current)
    });

    activeTurnByThread.set(sessionId, response.turn.id);
    await patchPeriodicTask(current.id, {
      sessionId,
      status: "running",
      activeTurnId: response.turn.id,
      lastRunAt: Date.now(),
      lastError: undefined,
      nextRunAt: undefined
    });
  } catch (error) {
    await patchPeriodicTask(current.id, {
      status: "error",
      activeTurnId: undefined,
      lastError: error instanceof Error ? error.message : String(error),
      nextRunAt: current.enabled ? nextPeriodicTaskRunAt(current, Date.now(), false) : undefined
    });
  }
}

async function ensurePeriodicTaskSession(
  codex: CodexAdapter,
  task: PeriodicTask
): Promise<string> {
  if (task.sessionMode === "existing") {
    if (!task.sessionId) {
      throw new Error("Periodic task requires a target session.");
    }
    return task.sessionId;
  }

  if (task.sessionId) {
    return task.sessionId;
  }

  const response = await codex.startThread({
    cwd: task.workspace,
    ...periodicTaskPermissionOptions(task.permissionMode),
    ...periodicTaskModelOptions(task)
  });
  const sessionId = response.thread.id;
  await codex.setThreadName(sessionId, `Periodic: ${task.name}`).catch(() => undefined);
  await patchPeriodicTask(task.id, { sessionId });
  return sessionId;
}

async function patchPeriodicTask(
  taskId: string,
  patch: Partial<PeriodicTask>
): Promise<void> {
  periodicTasks = periodicTasks.map(task =>
    task.id === taskId
      ? {
          ...task,
          ...patch,
          updatedAt: Date.now()
        }
      : task
  );
  await savePeriodicTasks();
}

function handlePeriodicTaskCodexEvent(event: CodexAdapterEvent): void {
  if (event.type === "turn.started") {
    activeTurnByThread.set(event.threadId, event.turnId);
    return;
  }

  if (event.type !== "turn.completed") {
    return;
  }

  const activeTurnId = activeTurnByThread.get(event.threadId);
  if (!activeTurnId || activeTurnId === event.turnId) {
    activeTurnByThread.delete(event.threadId);
  }

  const task = periodicTasks.find(item => item.activeTurnId === event.turnId);
  if (!task) {
    return;
  }

  const now = Date.now();
  void patchPeriodicTask(task.id, {
    activeTurnId: undefined,
    lastCompletedAt: now,
    lastError: undefined,
    nextRunAt: task.enabled ? nextPeriodicTaskRunAt(task, now, false) : undefined,
    status: task.enabled ? "waiting" : "paused"
  });
}

function nextPeriodicTaskRunAt(
  task: Pick<
    PeriodicTask,
    "trigger" | "intervalMs" | "scheduleFrequency" | "scheduleTime" | "scheduleWeekdays"
  >,
  from: number,
  allowImmediateInterval: boolean
): number {
  if (task.trigger !== "schedule") {
    return allowImmediateInterval ? from : from + task.intervalMs;
  }

  return nextScheduledTaskRunAt(
    task.scheduleFrequency,
    task.scheduleTime,
    task.scheduleWeekdays,
    from
  );
}

function nextScheduledTaskRunAt(
  frequency: PeriodicTaskScheduleFrequency,
  time: string,
  weekdays: number[],
  from: number
): number {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const base = new Date(from);
  const daysToCheck = frequency === "weekly" ? 14 : 8;
  const activeWeekdays = weekdays.length > 0 ? weekdays : [base.getDay()];

  for (let offset = 0; offset < daysToCheck; offset += 1) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if (frequency === "weekly" && !activeWeekdays.includes(candidate.getDay())) {
      continue;
    }
    if (candidate.getTime() > from) {
      return candidate.getTime();
    }
  }

  const fallback = new Date(base);
  fallback.setDate(base.getDate() + 1);
  fallback.setHours(hour, minute, 0, 0);
  return fallback.getTime();
}

function normalizePeriodicTaskInput(input: PeriodicTaskInput): Omit<
  PeriodicTask,
  "id" | "status" | "activeTurnId" | "nextRunAt" | "lastRunAt" | "lastCompletedAt" | "lastError" | "createdAt" | "updatedAt"
> {
  const name = String(input.name ?? "").trim();
  const workspace = String(input.workspace ?? "").trim();
  const prompt = String(input.prompt ?? "").trim();
  const sessionMode = input.sessionMode === "existing" ? "existing" : "create_once";
  const trigger = input.trigger === "schedule" ? "schedule" : "interval";
  const scheduleFrequency = input.scheduleFrequency === "weekly" ? "weekly" : "daily";
  const scheduleTime = normalizeScheduleTime(input.scheduleTime);
  const scheduleWeekdays = normalizeScheduleWeekdays(input.scheduleWeekdays);

  if (!name) {
    throw new Error("Periodic task name is required.");
  }
  if (!workspace) {
    throw new Error("Periodic task workspace is required.");
  }
  if (!prompt) {
    throw new Error("Periodic task prompt is required.");
  }
  if (sessionMode === "existing" && !input.sessionId) {
    throw new Error("Choose a session or use a dedicated session.");
  }

  return {
    name,
    enabled: input.enabled ?? true,
    workspace,
    sessionMode,
    sessionId: stringOrUndefined(input.sessionId),
    prompt,
    trigger,
    intervalMs: Math.max(Math.floor(Number(input.intervalMs) || 0), 60_000),
    scheduleFrequency,
    scheduleTime,
    scheduleWeekdays,
    model: stringOrUndefined(input.model),
    effort: isReasoningEffort(input.effort) ? input.effort : undefined,
    permissionMode: isPeriodicTaskPermissionMode(input.permissionMode)
      ? input.permissionMode
      : "default"
  };
}

function normalizePeriodicTask(value: unknown): PeriodicTask | null {
  const record = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const id = stringOrUndefined(record.id);
  const name = stringOrUndefined(record.name);
  const workspace = stringOrUndefined(record.workspace);
  const prompt = stringOrUndefined(record.prompt);
  if (!id || !name || !workspace || !prompt) {
    return null;
  }

  const sessionMode = record.sessionMode === "existing" ? "existing" : "create_once";
  const status = isPeriodicTaskStatus(record.status) ? record.status : "waiting";
  const permissionMode = isPeriodicTaskPermissionMode(record.permissionMode)
    ? record.permissionMode
    : "default";
  const enabled = typeof record.enabled === "boolean" ? record.enabled : true;
  const trigger = record.trigger === "schedule" ? "schedule" : "interval";
  const intervalMs = Math.max(Math.floor(Number(record.intervalMs) || 0), 60_000);
  const scheduleFrequency = record.scheduleFrequency === "weekly" ? "weekly" : "daily";
  const scheduleTime = normalizeScheduleTime(record.scheduleTime);
  const scheduleWeekdays = normalizeScheduleWeekdays(record.scheduleWeekdays);
  const now = Date.now();
  const recoveredRunningTask = status === "running";
  const normalizedStatus = enabled
    ? recoveredRunningTask
      ? "waiting"
      : status
    : "paused";

  return {
    id,
    name,
    enabled,
    workspace,
    sessionMode,
    sessionId: stringOrUndefined(record.sessionId),
    prompt,
    trigger,
    intervalMs,
    scheduleFrequency,
    scheduleTime,
    scheduleWeekdays,
    model: stringOrUndefined(record.model),
    effort: isReasoningEffort(record.effort) ? record.effort : undefined,
    permissionMode,
    nextRunAt: recoveredRunningTask
      ? now
      : numberOrUndefined(record.nextRunAt) ??
        (enabled
          ? nextPeriodicTaskRunAt(
              { trigger, intervalMs, scheduleFrequency, scheduleTime, scheduleWeekdays },
              now,
              true
            )
          : undefined),
    lastRunAt: numberOrUndefined(record.lastRunAt),
    lastCompletedAt: numberOrUndefined(record.lastCompletedAt),
    lastError: recoveredRunningTask
      ? "Desktop restarted while this task was running."
      : stringOrUndefined(record.lastError),
    status: normalizedStatus,
    activeTurnId: undefined,
    createdAt: numberOrUndefined(record.createdAt) ?? now,
    updatedAt: numberOrUndefined(record.updatedAt) ?? now
  };
}

function periodicTaskPermissionOptions(value: PeriodicTaskPermissionMode): {
  approvalPolicy: string;
  approvalsReviewer: string;
  permissionProfile: string;
  sandbox?: string;
  sandboxPolicy?: JsonObject;
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

function periodicTaskModelOptions(task: PeriodicTask): {
  model?: string;
  effort?: ReasoningEffort | null;
} {
  return {
    model: task.model,
    effort: task.effort
  };
}

function normalizeScheduleTime(value: unknown): string {
  if (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return value;
  }
  return "09:00";
}

function normalizeScheduleWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [1];
  }
  const weekdays = Array.from(new Set(
    value
      .map(item => Math.floor(Number(item)))
      .filter(item => item >= 0 && item <= 6)
  )).sort((a, b) => a - b);
  return weekdays.length > 0 ? weekdays : [1];
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function isPeriodicTaskStatus(value: unknown): value is PeriodicTaskStatus {
  return (
    value === "idle" ||
    value === "waiting" ||
    value === "running" ||
    value === "paused" ||
    value === "error"
  );
}

function isPeriodicTaskPermissionMode(
  value: unknown
): value is PeriodicTaskPermissionMode {
  return value === "default" || value === "auto-review" || value === "full-access";
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function attachmentTempDir(): Promise<string> {
  const attachmentsDir = path.join(app.getPath("temp"), "codep-attachments");
  await mkdir(attachmentsDir, { recursive: true });
  return attachmentsDir;
}

async function clipboardAttachments(): Promise<ClipboardAttachmentResult> {
  const formats = clipboard.availableFormats();
  const filePaths = await clipboardFilePaths();
  if (filePaths.length > 0) {
    return {
      attachments: filePaths.map(filePath =>
        isImagePath(filePath) ? imageAttachment(filePath) : fileAttachment(filePath)
      ),
      formats
    };
  }

  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return { attachments: [], formats };
  }

  const attachmentsDir = await attachmentTempDir();
  const filePath = path.join(attachmentsDir, `clipboard-${Date.now()}.png`);
  await writeFile(filePath, image.toPNG());
  return { attachments: [imageAttachment(filePath, image)], formats };
}

async function chooseAttachmentFiles(): Promise<ComposerAttachment[]> {
  const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const options: OpenDialogOptions = {
    title: "Attach files",
    properties: ["openFile", "multiSelections"]
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled) {
    return [];
  }

  return result.filePaths.map(filePath =>
    isImagePath(filePath) ? imageAttachment(filePath) : fileAttachment(filePath)
  );
}

async function chooseNotificationSoundFile(): Promise<NotificationSoundFile | null> {
  const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const options: OpenDialogOptions = {
    title: "Choose notification sound",
    properties: ["openFile"],
    filters: [
      {
        name: "Audio",
        extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac", "webm"]
      },
      { name: "All files", extensions: ["*"] }
    ]
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled) {
    return null;
  }

  const filePath = result.filePaths[0];
  return filePath
    ? {
        path: filePath,
        url: pathToFileURL(filePath).toString(),
        name: path.basename(filePath)
      }
    : null;
}

async function searchWorkspaceFiles(options: {
  cwd: string;
  query?: string;
  limit?: number;
}): Promise<ComposerSuggestion[]> {
  const cwd = path.resolve(options.cwd);
  const query = normalizeSearchQuery(options.query);
  const limit = clampLimit(options.limit);
  const results: Array<ComposerSuggestion & { score: number }> = [];
  const queue: string[] = [cwd];
  let visited = 0;

  while (queue.length > 0 && visited < 7000 && results.length < limit * 4) {
    const directory = queue.shift();
    if (!directory) {
      continue;
    }
    visited += 1;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = toPosixPath(path.relative(cwd, fullPath));

      if (entry.isDirectory()) {
        if (!shouldSkipSearchDirectory(entry.name)) {
          queue.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile() || !matchesSearch(relativePath, query)) {
        continue;
      }

      const score = searchScore(relativePath, query);
      results.push({
        id: fullPath,
        type: "file",
        label: relativePath,
        name: entry.name,
        detail: path.dirname(relativePath) === "." ? undefined : path.dirname(relativePath),
        insertText: `@${relativePath}`,
        path: fullPath,
        score
      });
    }
  }

  return results
    .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ score: _score, ...item }) => item);
}

async function previewWorkspaceFile(options: {
  cwd: string;
  path: string;
  maxBytes?: number;
}): Promise<WorkspaceFilePreview> {
  const cwd = path.resolve(options.cwd);
  const requestedPath = String(options.path ?? "").trim();
  if (!requestedPath) {
    throw new Error("Missing file path.");
  }

  const targetPath = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(cwd, requestedPath);
  const relativePath = path.relative(cwd, targetPath);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("File preview is limited to the selected workspace.");
  }

  const fileStat = await stat(targetPath);
  if (!fileStat.isFile()) {
    throw new Error("Only regular files can be previewed.");
  }

  const maxBytes = Math.min(
    Math.max(Number(options.maxBytes) || 120000, 4096),
    240000
  );
  const bytesToRead = Math.min(fileStat.size, maxBytes);
  const buffer = Buffer.alloc(bytesToRead);
  const file = await openFile(targetPath, "r");
  let bytesRead = 0;
  try {
    const result = await file.read(buffer, 0, bytesToRead, 0);
    bytesRead = result.bytesRead;
  } finally {
    await file.close();
  }

  if (buffer.subarray(0, bytesRead).includes(0)) {
    throw new Error("Binary files cannot be previewed.");
  }

  return {
    path: targetPath,
    relativePath: toPosixPath(relativePath),
    name: path.basename(targetPath),
    content: buffer.subarray(0, bytesRead).toString("utf8"),
    size: fileStat.size,
    truncated: fileStat.size > bytesRead
  };
}

async function searchCodexSkills(options: {
  cwd?: string;
  query?: string;
  limit?: number;
  forceReload?: boolean;
}): Promise<ComposerSuggestion[]> {
  if (adapter) {
    try {
      return await searchCodexServerSkills(options);
    } catch {
      // Fall back for older Codex versions that do not expose skills/list.
    }
  }

  return searchLocalCodexSkills(options);
}

async function searchCodexServerSkills(options: {
  cwd?: string;
  query?: string;
  limit?: number;
  forceReload?: boolean;
}): Promise<ComposerSuggestion[]> {
  const query = normalizeSearchQuery(options.query);
  const limit = clampLimit(options.limit);
  const response = await adapter!.listSkills({
    cwds: options.cwd ? [path.resolve(options.cwd)] : undefined,
    forceReload: options.forceReload
  });
  const results: Array<ComposerSuggestion & { score: number }> = [];
  const seenNames = new Set<string>();

  for (const entry of response.data) {
    for (const skill of entry.skills) {
      if (!isEnabledSkill(skill) || seenNames.has(skill.name)) {
        continue;
      }
      seenNames.add(skill.name);

      const label = skill.interface?.displayName || skill.name;
      const detail =
        skill.description ||
        skill.shortDescription ||
        skill.interface?.shortDescription ||
        "Skill";
      const searchable = `${label} ${skill.name} ${detail}`;
      if (!matchesSearch(searchable, query)) {
        continue;
      }

      results.push({
        id: skill.path || `${entry.cwd}:${skill.name}`,
        type: "skill",
        label,
        name: skill.name,
        detail,
        insertText: `$${skill.name}`,
        path: skill.path,
        score: searchScore(searchable, query)
      });
    }
  }

  return sortComposerSuggestions(results, limit);
}

async function searchLocalCodexSkills(options: {
  query?: string;
  limit?: number;
}): Promise<ComposerSuggestion[]> {
  const query = normalizeSearchQuery(options.query);
  const limit = clampLimit(options.limit);
  const roots = [
    path.join(homedir(), ".codex", "skills"),
    path.join(homedir(), ".agents", "skills")
  ];
  const skillFiles = new Set<string>();
  for (const root of roots) {
    for (const skillFile of await findSkillFiles(root)) {
      skillFiles.add(skillFile);
    }
  }

  const results: Array<ComposerSuggestion & { score: number }> = [];
  const seenNames = new Set<string>();
  for (const skillFile of skillFiles) {
    const skill = await readSkillSummary(skillFile);
    if (!skill || seenNames.has(skill.name)) {
      continue;
    }
    seenNames.add(skill.name);

    const searchable = `${skill.name} ${skill.description}`;
    if (!matchesSearch(searchable, query)) {
      continue;
    }

    results.push({
      id: skillFile,
      type: "skill",
      label: skill.name,
      name: skill.name,
      detail: skill.description || "Skill",
      insertText: `$${skill.name}`,
      path: skillFile,
      score: searchScore(searchable, query)
    });
  }

  return sortComposerSuggestions(results, limit);
}

async function saveRemoteAttachments(
  attachments: RemoteAttachmentInput[]
): Promise<ComposerAttachment[]> {
  if (!Array.isArray(attachments)) {
    throw new Error("Remote attachments must be an array");
  }

  const attachmentsDir = await attachmentTempDir();
  const savedAttachments: ComposerAttachment[] = [];

  for (const [index, attachment] of attachments.entries()) {
    if (!attachment || attachment.kind !== "image") {
      continue;
    }
    if (!attachment.mimeType.startsWith("image/")) {
      throw new Error(`Unsupported remote attachment type: ${attachment.mimeType}`);
    }

    const parsed = parseBase64DataUrl(attachment.dataUrl);
    if (!parsed || !parsed.mimeType.startsWith("image/")) {
      throw new Error(`Invalid remote image payload: ${attachment.name || index}`);
    }

    const safeName = safeAttachmentName(
      attachment.name,
      `remote-image-${Date.now()}-${index}${extensionForMimeType(parsed.mimeType)}`
    );
    const fileName = ensureImageExtension(
      `remote-${Date.now()}-${index}-${safeName}`,
      parsed.mimeType
    );
    const filePath = path.join(attachmentsDir, fileName);
    await writeFile(filePath, parsed.buffer);
    savedAttachments.push(
      imageAttachment(
        filePath,
        nativeImage.createFromBuffer(parsed.buffer),
        attachment.dataUrl
      )
    );
  }

  return savedAttachments;
}

async function clipboardFilePaths(): Promise<string[]> {
  const formats = clipboard.availableFormats();
  const candidates = [
    clipboard.readText(),
    ...formats
      .filter(isLikelyClipboardFileFormat)
      .flatMap(format => readClipboardFormatText(format))
  ];

  const paths = new Set<string>();
  for (const candidate of candidates) {
    for (const filePath of filePathsFromClipboardText(candidate)) {
      if (await isExistingPath(filePath)) {
        paths.add(filePath);
      }
    }
  }

  return [...paths];
}

function readClipboardFormatText(format: string): string[] {
  const values: string[] = [];
  try {
    values.push(clipboard.read(format));
  } catch {
    // Some platform clipboard formats are exposed but cannot be decoded as text.
  }

  try {
    values.push(clipboard.readBuffer(format).toString("utf8"));
  } catch {
    // Binary-only formats are ignored by the path parser below.
  }

  return values;
}

function isLikelyClipboardFileFormat(format: string): boolean {
  const normalized = format.toLowerCase();
  return (
    normalized.includes("uri-list") ||
    normalized.includes("gnome-copied-files") ||
    normalized.includes("file") ||
    normalized.includes("filename") ||
    normalized.includes("nautilus") ||
    normalized.includes("kde")
  );
}

function filePathsFromClipboardText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#"))
    .filter(line => line !== "copy" && line !== "cut")
    .map(line => {
      try {
        if (line.startsWith("file://")) {
          return fileURLToPath(line);
        }
      } catch {
        return "";
      }
      return path.isAbsolute(line) ? line : "";
    })
    .filter(Boolean);
}

async function isExistingPath(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function imageAttachment(
  filePath: string,
  image = nativeImage.createFromPath(filePath),
  previewDataUrl?: string
): ComposerAttachment {
  const thumbnail = image.isEmpty() ? null : image.resize({ width: 160 });
  return {
    id: `${filePath}-${Date.now()}`,
    type: "localImage",
    path: filePath,
    name: path.basename(filePath),
    previewDataUrl:
      previewDataUrl ?? (thumbnail && !thumbnail.isEmpty() ? thumbnail.toDataURL() : undefined)
  };
}

function fileAttachment(filePath: string): ComposerAttachment {
  return {
    id: `${filePath}-${Date.now()}`,
    type: "mention",
    path: filePath,
    name: path.basename(filePath)
  };
}

function isImagePath(filePath: string): boolean {
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"].includes(
    path.extname(filePath).toLowerCase()
  );
}

function shouldSkipSearchDirectory(name: string): boolean {
  return new Set([
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    ".turbo",
    "coverage"
  ]).has(name);
}

async function findSkillFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  let visited = 0;

  while (queue.length > 0 && visited < 3000) {
    const directory = queue.shift();
    if (!directory) {
      continue;
    }
    visited += 1;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipSearchDirectory(entry.name)) {
          queue.push(fullPath);
        }
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function readSkillSummary(
  skillFile: string
): Promise<{ name: string; description: string } | null> {
  try {
    const content = await readFile(skillFile, "utf8");
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? "";
    const name =
      frontMatter.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ||
      path.basename(path.dirname(skillFile));
    const description =
      frontMatter.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ||
      "";
    return { name, description };
  } catch {
    return null;
  }
}

function normalizeSearchQuery(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 30;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 80);
}

function sortComposerSuggestions(
  results: Array<ComposerSuggestion & { score: number }>,
  limit: number
): ComposerSuggestion[] {
  return results
    .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ score: _score, ...item }) => item);
}

function isEnabledSkill(skill: SkillMetadata): boolean {
  return skill.enabled !== false;
}

function matchesSearch(value: string, query: string): boolean {
  return query.length === 0 || value.toLowerCase().includes(query);
}

function searchScore(value: string, query: string): number {
  if (query.length === 0) {
    return value.includes("/") ? 2 : 0;
  }

  const normalized = value.toLowerCase();
  const baseName = path.basename(normalized);
  if (baseName === query) {
    return 0;
  }
  if (baseName.startsWith(query)) {
    return 1;
  }
  if (normalized.startsWith(query)) {
    return 2;
  }
  const index = normalized.indexOf(query);
  return index >= 0 ? 3 + index / 1000 : 1000;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function parseBase64DataUrl(
  value: string
): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  if (!match) {
    return null;
  }
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function safeAttachmentName(name: string, fallback: string): string {
  const trimmed = name.trim();
  const safe = (trimmed || fallback)
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return safe || fallback;
}

function ensureImageExtension(fileName: string, mimeType: string): string {
  return path.extname(fileName) ? fileName : `${fileName}${extensionForMimeType(mimeType)}`;
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    case "image/tiff":
      return ".tiff";
    default:
      return ".png";
  }
}
