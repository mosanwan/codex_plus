import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("Windows packaging must run on Windows.");
}

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const rootPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const desktopPackage = JSON.parse(
  await readFile(path.join(repoRoot, "apps/desktop/package.json"), "utf8")
);

const version = desktopPackage.version ?? rootPackage.version ?? "0.1.0";
const targetArch = parseTargetArch();
const packageName = "codex-plus";
const productName = "Codex+";
const releaseDir = path.join(repoRoot, "release");
const stagingDir = path.join(releaseDir, `windows-${targetArch}`);
const appDir = path.join(stagingDir, productName);
const appResourcesDir = path.join(appDir, "resources", "app");
const zipPath = path.join(releaseDir, `${packageName}_${version}_windows_${targetArch}.zip`);

if (targetArch !== process.arch) {
  throw new Error(
    `Target arch ${targetArch} must match the Windows runner arch ${process.arch}.`
  );
}

runNpm(["--workspace", "@codep/codex-adapter", "run", "build"]);
runNpm(["--workspace", "@codep/desktop", "run", "build"]);

const electronDist = path.join(repoRoot, "node_modules", "electron", "dist");
const electronExecutable = path.join(electronDist, "electron.exe");
if (!existsSync(electronExecutable)) {
  throw new Error(`electron.exe was not found at ${electronExecutable}. Run npm ci on Windows first.`);
}

await rm(stagingDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(appResourcesDir, { recursive: true });

await cp(electronDist, appDir, {
  recursive: true,
  preserveTimestamps: true
});

const productExecutable = path.join(appDir, `${productName}.exe`);
if (existsSync(path.join(appDir, "electron.exe"))) {
  await rename(path.join(appDir, "electron.exe"), productExecutable);
}

await cp(path.join(repoRoot, "apps/desktop/dist"), path.join(appResourcesDir, "dist"), {
  recursive: true
});
await cp(
  path.join(repoRoot, "apps/desktop/dist-electron"),
  path.join(appResourcesDir, "dist-electron"),
  { recursive: true }
);

await writeJson(path.join(appResourcesDir, "package.json"), {
  name: packageName,
  productName,
  version,
  type: "module",
  main: "dist-electron/main.js"
});

const adapterDest = path.join(appResourcesDir, "node_modules", "@codep", "codex-adapter");
await mkdir(adapterDest, { recursive: true });
await cp(path.join(repoRoot, "packages/codex-adapter/dist"), path.join(adapterDest, "dist"), {
  recursive: true
});
await cp(path.join(repoRoot, "packages/codex-adapter/package.json"), path.join(adapterDest, "package.json"));

run("powershell.exe", [
  "-NoLogo",
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  `Compress-Archive -LiteralPath ${psQuote(appDir)} -DestinationPath ${psQuote(zipPath)} -Force`
]);

console.log(`Built ${path.relative(repoRoot, zipPath)}`);

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

function runNpm(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    run(process.execPath, [npmExecPath, ...args]);
    return;
  }

  run("npm", args);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function parseTargetArch() {
  if (process.argv.includes("--x64")) {
    return "x64";
  }
  if (process.argv.includes("--arm64")) {
    return "arm64";
  }
  return process.arch;
}
