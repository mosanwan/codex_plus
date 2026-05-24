import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  type OpenDialogOptions
} from "electron";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CodexAdapter,
  type CodexAdapterEvent,
  type InitializeResponse,
  type UserInput
} from "@codep/codex-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "CodeP Desktop",
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
          title: "CodeP Desktop",
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

  ipcMain.handle("codex:thread:start", async (_event, options: { cwd: string }) => {
    if (!adapter) {
      throw new Error("Codex adapter is not connected");
    }
    return adapter.startThread({ cwd: options.cwd });
  });

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
    "codex:thread:resume",
    async (_event, options: { threadId: string; cwd: string }) => {
      if (!adapter) {
        throw new Error("Codex adapter is not connected");
      }
      return adapter.resumeThread(options.threadId, {
        cwd: options.cwd,
        excludeTurns: false
      });
    }
  );

  ipcMain.handle(
    "codex:turn:start",
    async (
      _event,
      options: { threadId: string; text: string; input?: UserInput[] }
    ) => {
      if (!adapter) {
        throw new Error("Codex adapter is not connected");
      }
      if (options.input) {
        return adapter.startTurnWithInput(options.threadId, options.input);
      }
      return adapter.startTurn(options.threadId, options.text);
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

function imageAttachment(filePath: string, image = nativeImage.createFromPath(filePath)): ComposerAttachment {
  const thumbnail = image.isEmpty() ? null : image.resize({ width: 160 });
  return {
    id: `${filePath}-${Date.now()}`,
    type: "localImage",
    path: filePath,
    name: path.basename(filePath),
    previewDataUrl: thumbnail && !thumbnail.isEmpty() ? thumbnail.toDataURL() : undefined
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
