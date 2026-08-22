#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const defaultJavaHome = resolve(homedir(), ".local/share/jdks/jdk-21");
const defaultAndroidHome = resolve(homedir(), "Android/Sdk");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const javaExecutable = `java${executableSuffix}`;
const adbExecutable = `adb${executableSuffix}`;
const androidRoot = resolve(repoRoot, "apps/mobile/android");
const gradleWrapper = resolve(
  androidRoot,
  process.platform === "win32" ? "gradlew.bat" : "gradlew"
);

const args = process.argv.slice(2);
const targetArgIndex = args.findIndex(arg => arg === "--target" || arg === "-t");
const explicitTarget =
  targetArgIndex >= 0 ? args[targetArgIndex + 1] : process.env.ANDROID_TARGET;

const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME || defaultJavaHome,
  ANDROID_HOME: process.env.ANDROID_HOME || defaultAndroidHome,
  ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || defaultAndroidHome
};
env.PATH = [
  resolve(env.JAVA_HOME, "bin"),
  resolve(env.ANDROID_HOME, "platform-tools"),
  env.PATH
]
  .filter(Boolean)
  .join(delimiter);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, commandArgs, cwd = repoRoot) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    stdio: "inherit"
  });
  if (result.error) {
    fail(`Failed to start ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function output(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout;
}

function runGradle(tasks) {
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", gradleWrapper, ...tasks], androidRoot);
    return;
  }
  run(gradleWrapper, tasks, androidRoot);
}

if (!existsSync(resolve(env.JAVA_HOME, "bin", javaExecutable))) {
  fail(`JDK not found at ${env.JAVA_HOME}. Set JAVA_HOME or install JDK 21 there.`);
}

if (!existsSync(resolve(env.ANDROID_HOME, "platform-tools", adbExecutable))) {
  fail(
    `Android SDK not found at ${env.ANDROID_HOME}. Set ANDROID_HOME/ANDROID_SDK_ROOT.`
  );
}

const adbDevices = output(adbExecutable, ["devices"])
  .split("\n")
  .slice(1)
  .map(line => line.trim().split(/\s+/))
  .filter(([id, state]) => id && state === "device")
  .map(([id]) => id);

const target = explicitTarget || adbDevices[0];
if (!target) {
  fail("No Android device is connected over ADB.");
}

console.log(`Installing mobile app to Android device ${target}`);
runGradle([":app:assembleDebug"]);
run(adbExecutable, [
  "-s",
  target,
  "install",
  "-r",
  resolve(repoRoot, "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk")
]);
run(adbExecutable, [
  "-s",
  target,
  "shell",
  "am",
  "start",
  "-n",
  "app.codep.mobile/.MainActivity"
]);
