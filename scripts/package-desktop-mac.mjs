import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("macOS packaging must run on macOS.");
}

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const require = createRequire(import.meta.url);
const rootPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const desktopPackage = JSON.parse(
  await readFile(path.join(repoRoot, "apps/desktop/package.json"), "utf8")
);

const version = desktopPackage.version ?? rootPackage.version ?? "0.1.0";
const targetArch = parseTargetArch();
const packageName = "codex-plus";
const productName = "Codex+";
const bundleId = "app.codep.desktop";
const releaseDir = path.join(repoRoot, "release");
const stagingDir = path.join(releaseDir, `macos-${targetArch}`);
const appPath = path.join(stagingDir, `${productName}.app`);
const appResourcesDir = path.join(appPath, "Contents", "Resources", "app");
const appContentsResourcesDir = path.join(appPath, "Contents", "Resources");
const zipPath = path.join(releaseDir, `${packageName}_${version}_macos_${targetArch}.app.zip`);
const dmgRoot = path.join(stagingDir, "dmg");
const dmgPath = path.join(releaseDir, `${packageName}_${version}_macos_${targetArch}.dmg`);

if (targetArch !== process.arch) {
  throw new Error(
    `Target arch ${targetArch} must match the macOS runner arch ${process.arch}. ` +
      "Build x64 on macos-*-intel and arm64 on an Apple Silicon runner."
  );
}

run("npm", ["--workspace", "@codep/codex-adapter", "run", "build"]);
run("npm", ["--workspace", "@codep/desktop", "run", "build"]);

const electronPackageDir = path.dirname(
  require.resolve("electron/package.json", {
    paths: [path.join(repoRoot, "apps/desktop"), repoRoot]
  })
);
const electronApp = await ensureElectronBinary(electronPackageDir, "darwin", targetArch);

await rm(stagingDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await rm(dmgPath, { force: true });
run("ditto", [electronApp, appPath]);

const defaultAppAsar = path.join(appPath, "Contents", "Resources", "default_app.asar");
await rm(defaultAppAsar, { force: true });
await mkdir(appResourcesDir, { recursive: true });

const electronExecutable = path.join(appPath, "Contents", "MacOS", "Electron");
const productExecutable = path.join(appPath, "Contents", "MacOS", productName);
if (existsSync(electronExecutable)) {
  await rename(electronExecutable, productExecutable);
}

await cp(path.join(repoRoot, "apps/desktop/dist"), path.join(appResourcesDir, "dist"), {
  recursive: true
});
await cp(
  path.join(repoRoot, "apps/desktop/dist-electron"),
  path.join(appResourcesDir, "dist-electron"),
  { recursive: true }
);
await cp(path.join(repoRoot, "apps/desktop/assets"), path.join(appResourcesDir, "assets"), {
  recursive: true
});
await cp(
  path.join(repoRoot, "apps/desktop/assets/codex-plus.icns"),
  path.join(appContentsResourcesDir, "codex-plus.icns")
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

const plistPath = path.join(appPath, "Contents", "Info.plist");
setPlistValue(plistPath, "CFBundleExecutable", "string", productName);
setPlistValue(plistPath, "CFBundleName", "string", productName);
setPlistValue(plistPath, "CFBundleDisplayName", "string", productName);
setPlistValue(plistPath, "CFBundleIdentifier", "string", bundleId);
setPlistValue(plistPath, "CFBundleShortVersionString", "string", version);
setPlistValue(plistPath, "CFBundleVersion", "string", version);
setPlistValue(plistPath, "CFBundleIconFile", "string", "codex-plus.icns");
setPlistValue(plistPath, "LSApplicationCategoryType", "string", "public.app-category.developer-tools");

run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath]);

await mkdir(dmgRoot, { recursive: true });
run("ditto", [appPath, path.join(dmgRoot, `${productName}.app`)]);
await symlink("/Applications", path.join(dmgRoot, "Applications"));
createDmg();

console.log(`Built ${path.relative(repoRoot, zipPath)}`);
console.log(`Built ${path.relative(repoRoot, dmgPath)}`);

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

async function ensureElectronBinary(electronPackageDir, platform, arch) {
  const electronDist = path.join(electronPackageDir, "dist");
  const electronApp = path.join(electronDist, "Electron.app");
  if (existsSync(electronApp)) {
    return electronApp;
  }

  const electronPackage = JSON.parse(
    await readFile(path.join(electronPackageDir, "package.json"), "utf8")
  );
  const zipPath = await downloadElectronZip(electronPackage.version, platform, arch);

  await rm(electronDist, { recursive: true, force: true });
  await mkdir(electronDist, { recursive: true });
  extractElectronZip(zipPath, electronDist);
  await writeFile(
    path.join(electronPackageDir, "path.txt"),
    "Electron.app/Contents/MacOS/Electron"
  );

  if (!existsSync(electronApp)) {
    throw new Error(`Electron.app was not found at ${electronApp}. Electron download did not complete.`);
  }
  return electronApp;
}

async function downloadElectronZip(electronVersion, platform, arch) {
  const artifactName = `electron-v${electronVersion}-${platform}-${arch}.zip`;
  const zipPath = path.join(releaseDir, artifactName);
  const url = `https://github.com/electron/electron/releases/download/v${electronVersion}/${artifactName}`;
  await mkdir(releaseDir, { recursive: true });
  run(curlCommand(), ["-L", "--fail", "--retry", "3", "-o", zipPath, url]);
  return zipPath;
}

function curlCommand() {
  return process.platform === "win32" ? "curl.exe" : "curl";
}

function extractElectronZip(zipPath, destinationDir) {
  run("unzip", ["-q", zipPath, "-d", destinationDir]);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function setPlistValue(plistPath, key, type, value) {
  const command = "/usr/libexec/PlistBuddy";
  const setArgs = ["-c", `Set :${key} ${value}`, plistPath];
  const addArgs = ["-c", `Add :${key} ${type} ${value}`, plistPath];

  try {
    execFileSync(command, setArgs, { stdio: "ignore" });
  } catch {
    execFileSync(command, addArgs, { stdio: "inherit" });
  }
}

function createDmg() {
  const args = [
    "create",
    "-volname",
    productName,
    "-srcfolder",
    dmgRoot,
    "-ov",
    "-format",
    "UDZO",
    dmgPath
  ];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      run("hdiutil", args);
      return;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }

      try {
        execFileSync("hdiutil", ["detach", `/Volumes/${productName}`, "-force"], {
          stdio: "ignore"
        });
      } catch {
        // The volume is usually not mounted; this is just a best-effort cleanup.
      }
      try {
        execFileSync("rm", ["-f", dmgPath], { stdio: "ignore" });
      } catch {
        // Retry will report the real hdiutil failure if cleanup did not help.
      }
      execFileSync("sleep", [String(attempt)]);
    }
  }
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
