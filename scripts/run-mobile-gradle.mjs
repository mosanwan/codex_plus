#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const androidRoot = resolve(import.meta.dirname, "../apps/mobile/android");
const wrapper = resolve(
  androidRoot,
  process.platform === "win32" ? "gradlew.bat" : "gradlew"
);
const tasks = process.argv.slice(2);

if (tasks.length === 0) {
  console.error("At least one Gradle task is required.");
  process.exit(1);
}

const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : wrapper;
const commandArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", wrapper, ...tasks]
  : tasks;
const result = spawnSync(command, commandArgs, {
  cwd: androidRoot,
  env: process.env,
  stdio: "inherit"
});

if (result.error) {
  console.error(`Failed to start Gradle wrapper: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
