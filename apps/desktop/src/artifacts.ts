export interface GeneratedImageEntry {
  id: string;
  role: "artifact" | "error";
  text: string;
  imagePath?: string;
  meta?: string;
}

export function normalizePreviewHref(value: string): string {
  const trimmed = value.trim().replace(/^<(.+)>$/, "$1").split("#")[0].split("?")[0];
  if (!trimmed) return "";
  let raw = trimmed;
  if (/^file:\/\//i.test(raw)) {
    try { raw = new URL(raw).pathname; } catch { return ""; }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) {
    return "";
  }
  try { raw = decodeURIComponent(raw); } catch { /* Preserve literal percent signs. */ }
  return raw.replace(/^[/\\]+(?=[a-z]:[/\\])/i, "").trim();
}

export function imageGenerationEntry(id: string, record: Record<string, unknown>): GeneratedImageEntry {
  const imagePath = typeof record.savedPath === "string" && record.savedPath ? record.savedPath : undefined;
  if (record.status === "failed") {
    const failure = record.failure;
    const message = typeof failure === "string" ? failure :
      failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Image generation failed";
    return { id: `image-${id}`, role: "error", text: message };
  }
  return { id: `image-${id}`, role: "artifact", imagePath,
    text: imagePath ?? "Generating image…", meta: typeof record.status === "string" ? record.status : undefined };
}

export function artifactMessageReference(entry: { id: string; imagePath?: string; text: string }) {
  return {
    id: entry.id, role: "artifact" as const, text: entry.imagePath ?? entry.text, meta: "image",
    // Never put original bytes in snapshots or the reliable event backlog.
    attachments: entry.imagePath ? [{ id: entry.id, kind: "image" as const, path: entry.imagePath,
      name: entry.imagePath.split(/[\\/]/).at(-1) ?? "image", mimeType: "image/png" }] : []
  };
}

export interface FileCitationReference {
  id: string;
  kind: "image" | "file";
  path: string;
  name: string;
  mimeType: string;
}

export function renderFileCitations(text: string, markdown = true): { text: string; files: FileCitationReference[] } {
  const files: FileCitationReference[] = [];
  const rendered = text.replace(/:{1,2}codex-file-citation\{((?:"(?:\\.|[^"\\])*"|[^"}])*)\}/g, (original, attributes: string) => {
    const fields: Record<string, string> = {};
    for (const match of attributes.matchAll(/([\w-]+)\s*=\s*"((?:\\.|[^"\\])*)"/g)) {
      fields[match[1]] = match[2].replace(/\\(["\\/])/g, "$1");
    }
    const path = fields.path?.trim();
    if (!path) return original;
    const name = path.split(/[\\/]/).at(-1) || path;
    files.push({ id: `file-citation-${files.length}`, kind: /\.(png|jpe?g|webp|gif|bmp)$/i.test(path) ? "image" : "file", path, name, mimeType: "application/octet-stream" });
    const href = encodeURI(path.replace(/\\/g, "/")).replace(/#/g, "%23").replace(/\?/g, "%3F").replace(/\(/g, "%28").replace(/\)/g, "%29");
    const label = name.replace(/[\[\]\\]/g, "\\$&");
    return markdown ? `[${label}](<${href}>)` : name;
  });
  return { text: rendered, files };
}
