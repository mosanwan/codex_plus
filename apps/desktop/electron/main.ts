import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  type OpenDialogOptions
} from "electron";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, mkdir, stat, writeFile } from "node:fs/promises";
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
  const ozonePlatform = process.env.CODEX_PLUS_OZONE_PLATFORM ?? "x11";
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

interface UserSettings {
  codexCommandPath?: string;
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

interface NotificationSoundFile {
  path: string;
  url: string;
  name: string;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Codex+ Desktop",
    autoHideMenuBar: true,
    backgroundColor: "#f6f7f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setMenu(null);

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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
    return adapter.getStatus();
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
}

function sendCodexEvent(event: CodexAdapterEvent): void {
  mainWindow?.webContents.send("codex:event", event);
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
