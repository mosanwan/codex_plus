import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, truncate, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { readArtifactPreview, resolveArtifactPath } from "../electron/file-artifacts.ts";

async function removeFixture(root: string) {
  assert.ok(path.isAbsolute(root) && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith("codep-artifact-test-"));
  await rm(root, { recursive: true, force: true });
}

test("on-demand previews read generated images and preserve original file bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codep-artifact-test-"));
  try {
    const workspace = path.join(root, "workspace"), generated = path.join(root, "generated_images");
    await mkdir(workspace); await mkdir(generated);
    const bytes = Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]);
    const image = path.join(generated, "fox.png"); await writeFile(image, bytes);
    const preview = await readArtifactPreview(workspace, image, generated);
    assert.equal(preview.mimeType, "image/png");
    assert.deepEqual(Buffer.from(preview.dataUrl!.split(",")[1], "base64"), bytes);
    assert.equal(await resolveArtifactPath(workspace, pathToFileURL(image).href, generated), await realpath(image));
    if (process.platform === "win32") {
      // This is the Markdown destination emitted in the user's failing reply.
      const textPath = path.join(workspace, "测试文本.txt");
      await writeFile(textPath, "中文 UTF-8 text 123");
      const markdownPath = "/" + textPath.replace(/\\/g, "/");
      assert.equal(await resolveArtifactPath(workspace, markdownPath, generated), await realpath(textPath));
      const loaded = await readArtifactPreview(workspace, markdownPath, generated, undefined, true);
      assert.equal(loaded.content, "中文 UTF-8 text 123");
      assert.equal(Buffer.from(loaded.dataUrl!.split(",")[1], "base64").toString(), loaded.content);
    }
    const text = "a".repeat(150_000); await writeFile(path.join(workspace, "notes.txt"), text);
    const ordinary = await readArtifactPreview(workspace, "notes.txt", generated);
    assert.equal(ordinary.dataUrl, undefined);
    assert.equal(ordinary.truncated, true);
    const original = await readArtifactPreview(workspace, "notes.txt", generated, undefined, true);
    assert.equal(Buffer.from(original.dataUrl!.split(",")[1], "base64").toString(), text);
  } finally { await removeFixture(root); }
});

test("paths outside allowed roots and oversized originals are rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codep-artifact-test-"));
  try {
    const workspace = path.join(root, "workspace"), generated = path.join(root, "generated");
    await mkdir(workspace); await mkdir(generated); await writeFile(path.join(root, "private.png"), "private");
    await assert.rejects(resolveArtifactPath(workspace, "../private.png", generated), /limited/);
    const large = path.join(workspace, "large.pdf"); await writeFile(large, ""); await truncate(large, 20 * 1024 * 1024 + 1);
    await assert.rejects(readArtifactPreview(workspace, large, generated), /20 MB/);
  } finally { await removeFixture(root); }
});
