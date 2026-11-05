import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
  ".pdf": "application/pdf", ".zip": "application/zip", ".apk": "application/vnd.android.package-archive",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp3": "audio/mpeg", ".mp4": "video/mp4"
};

export async function resolveArtifactPath(cwd: string, value: string, generatedRoot: string): Promise<string> {
  const raw = /^file:\/\//i.test(value.trim()) ? fileURLToPath(value.trim()) : value.trim();
  // Codex Markdown links may use /C:/...; win32.resolve otherwise makes C:\C:\... .
  const requested = raw.replace(/^[/\\]+(?=[a-z]:[/\\])/i, "");
  if (!requested) throw new Error("Missing file path.");
  const target = await realpath(path.resolve(cwd, requested));
  const roots = await Promise.all([cwd, generatedRoot].map(root => realpath(root).catch(() => path.resolve(root))));
  if (!roots.some(root => {
    const relative = path.relative(root, target);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  })) throw new Error("File access is limited to the selected workspace and Codex generated images.");
  if (!(await stat(target)).isFile()) throw new Error("Only regular files can be opened.");
  return target;
}

export async function readArtifactPreview(cwd: string, value: string, generatedRoot: string, requestedMaxBytes?: number, original = false) {
  const target = await resolveArtifactPath(cwd, value, generatedRoot);
  const fileStat = await stat(target);
  const mimeType = MIME_TYPES[path.extname(target).toLowerCase()];
  const maxBytes = Math.min(Math.max(Number(requestedMaxBytes) || 120_000, 4096), 240_000);
  const file = await open(target, "r");
  const buffer = Buffer.alloc(Math.min(fileStat.size, maxBytes));
  let bytesRead = 0;
  try { bytesRead = (await file.read(buffer, 0, buffer.length, 0)).bytesRead; } finally { await file.close(); }
  const base = {
    path: target, relativePath: path.relative(cwd, target).split(path.sep).join("/"),
    name: path.basename(target), size: fileStat.size
  };
  const binary = Boolean(mimeType) || buffer.subarray(0, bytesRead).includes(0);
  if (original || binary) {
    if (fileStat.size > 20 * 1024 * 1024) throw new Error("This file exceeds the 20 MB loading limit.");
    const bytes = await readFile(target);
    const type = mimeType ?? (binary ? "application/octet-stream" : "text/plain");
    return { ...base, content: binary ? "" : buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: !binary && fileStat.size > bytesRead, mimeType: type, dataUrl: `data:${type};base64,${bytes.toString("base64")}` };
  }
  return { ...base, content: buffer.subarray(0, bytesRead).toString("utf8"), truncated: fileStat.size > bytesRead };
}
