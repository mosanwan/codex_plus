import { strict as assert } from "node:assert";
import { test } from "node:test";
import { artifactMessageReference, imageGenerationEntry, normalizePreviewHref, renderFileCitations } from "../src/artifacts.ts";

test("Codex /C:/ Markdown targets normalize to Windows paths on desktop", () => {
  const target = "C:/Workspace/ServoTest/outputs/sample-excel-20261106/测试文本.txt";
  for (const href of [target, "/" + target, encodeURI("/" + target), "file:///" + encodeURI(target)]) {
    assert.equal(normalizePreviewHref(href), target);
  }
  assert.equal(normalizePreviewHref("/home/user/file.txt"), "/home/user/file.txt");
  assert.equal(normalizePreviewHref("C:/Work/a%2Bb%23c.txt"), "C:/Work/a+b#c.txt");
  assert.equal(normalizePreviewHref("https://example.com/file.txt"), "");
});

test("completed image generation becomes a visible artifact with its saved path", () => {
  const entry = imageGenerationEntry("generated-1", { type: "imageGeneration", status: "completed", savedPath: "C:\\Users\\test\\.codex\\generated_images\\thread\\fox.png", result: null });
  assert.equal(entry.role, "artifact");
  assert.equal(entry.imagePath, "C:\\Users\\test\\.codex\\generated_images\\thread\\fox.png");
  const reference = artifactMessageReference(entry);
  assert.equal(reference.attachments[0].name, "fox.png");
  assert.deepEqual(Object.keys(reference.attachments[0]).sort(), ["id", "kind", "mimeType", "name", "path"]);
  assert.ok(!JSON.stringify(reference).includes("base64"));
});

test("Codex workbook citations render as local file links and metadata-only mobile attachments", () => {
  const source = ':codex-file-citation{path="C:/Workspace/ServoTest/outputs/示例销售记录.xlsx" artifact_kind="workbook" purpose="output"}';
  const desktop = renderFileCitations(source);
  assert.ok(desktop.text.startsWith("[示例销售记录.xlsx](<C:/Workspace/ServoTest/outputs/"));
  assert.ok(!desktop.text.includes("codex-file-citation"));
  const phone = renderFileCitations(source, false);
  assert.equal(phone.text, "示例销售记录.xlsx");
  assert.equal(phone.files[0].path, "C:/Workspace/ServoTest/outputs/示例销售记录.xlsx");
  assert.equal(phone.files[0].kind, "file");
  assert.ok(!JSON.stringify(phone).includes("base64"));
  const escaped = String.raw`:codex-file-citation{path="C:\\Work Space\\book (1).xlsx"}`;
  assert.equal(renderFileCitations(escaped).files[0].path, String.raw`C:\Work Space\book (1).xlsx`);
});

test("pending images have no file to load and failed images remain visible errors", () => {
  assert.equal(artifactMessageReference(imageGenerationEntry("pending", { status: "inProgress" })).attachments.length, 0);
  assert.equal(imageGenerationEntry("failed", { status: "failed", failure: { message: "Generation failed" } }).role, "error");
});
