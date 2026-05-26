import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  type OpenDialogOptions
} from "electron";
import { readdir, readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

    if (!adapter) {
      adapter = new CodexAdapter({
        clientInfo: {
          name: "codep-desktop",
          title: "Codex+ Desktop",
          version: app.getVersion()
        }
      });

      adapter.on("event", event => {
        sendCodexEvent(event);
      });
      adapter.on("error", error => {
        sendCodexEvent({
          type: "raw.notification",
          method: "adapter/error",
          raw: {
            method: "adapter/error",
            params: { message: error.message }
          }
        });
      });
    }

    connectPromise = adapter
      .connect()
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
