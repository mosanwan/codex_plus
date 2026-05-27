import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const rootPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const desktopPackage = JSON.parse(
  await readFile(path.join(repoRoot, "apps/desktop/package.json"), "utf8")
);

const version = desktopPackage.version ?? rootPackage.version ?? "0.1.0";
const arch = debArch(process.arch);
const packageName = "codex-plus";
const productName = "Codex+";
const appDirName = "codex-plus";
const releaseDir = path.join(repoRoot, "release");
const stagingRoot = path.join(releaseDir, `${packageName}_${version}_${arch}`);
const optDir = path.join(stagingRoot, "opt", appDirName);
const appResourcesDir = path.join(optDir, "resources", "app");
const debPath = path.join(releaseDir, `${packageName}_${version}_${arch}.deb`);

run("npm", ["--workspace", "@codep/codex-adapter", "run", "build"]);
run("npm", ["--workspace", "@codep/desktop", "run", "build"]);

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(appResourcesDir, { recursive: true });

await cp(path.join(repoRoot, "node_modules/electron/dist"), optDir, {
  recursive: true,
  preserveTimestamps: true
});

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

await installText(
  path.join(stagingRoot, "usr", "bin", packageName),
  `#!/bin/sh
set -eu

export CODEX_PLUS_OZONE_PLATFORM="\${CODEX_PLUS_OZONE_PLATFORM:-x11}"
OZONE_PLATFORM="$CODEX_PLUS_OZONE_PLATFORM"
CHROMIUM_ARGS="--ozone-platform=$OZONE_PLATFORM"
if [ "$OZONE_PLATFORM" != "x11" ] && [ -z "\${CODEX_PLUS_DISABLE_WAYLAND_IME:-}" ]; then
  CHROMIUM_ARGS="--ozone-platform=$OZONE_PLATFORM --enable-wayland-ime --wayland-text-input-version=\${CODEX_PLUS_WAYLAND_TEXT_INPUT_VERSION:-3} --enable-features=\${CODEX_PLUS_ENABLE_FEATURES:-WaylandWindowDecorations}"
  if [ -n "\${CODEX_PLUS_GTK_VERSION:-}" ]; then
    CHROMIUM_ARGS="$CHROMIUM_ARGS --gtk-version=\${CODEX_PLUS_GTK_VERSION}"
  fi
fi

exec /opt/${appDirName}/electron $CHROMIUM_ARGS /opt/${appDirName}/resources/app "$@"
`,
  0o755
);

await installText(
  path.join(stagingRoot, "usr", "share", "applications", `${packageName}.desktop`),
  `[Desktop Entry]
Name=${productName}
Comment=Desktop Codex client
Exec=${packageName} %U
Icon=${packageName}
Terminal=false
Type=Application
Categories=Development;Utility;
StartupWMClass=${productName}
`,
  0o644
);

await cp(
  path.join(repoRoot, "apps/desktop/assets/codex-plus.svg"),
  path.join(stagingRoot, "usr", "share", "icons", "hicolor", "scalable", "apps", `${packageName}.svg`)
);

await installText(
  path.join(stagingRoot, "DEBIAN", "control"),
  `Package: ${packageName}
Version: ${version}
Section: devel
Priority: optional
Architecture: ${arch}
Maintainer: Codex+ <noreply@example.local>
Depends: libgtk-3-0, libnss3, libxss1, libx11-xcb1, libgbm1, libasound2 | libasound2t64, libatk-bridge2.0-0, libxkbcommon0
Description: Codex+ desktop client
 A desktop client that connects to the local Codex CLI app-server.
`,
  0o644
);

await installText(
  path.join(stagingRoot, "DEBIAN", "postinst"),
  `#!/bin/sh
set -e
if [ -f /opt/${appDirName}/chrome-sandbox ]; then
  chown root:root /opt/${appDirName}/chrome-sandbox || true
  chmod 4755 /opt/${appDirName}/chrome-sandbox || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi
`,
  0o755
);

await installText(
  path.join(stagingRoot, "DEBIAN", "postrm"),
  `#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi
`,
  0o755
);

await chmod(path.join(optDir, "electron"), 0o755);
await rm(debPath, { force: true });
run("dpkg-deb", ["--root-owner-group", "--build", stagingRoot, debPath]);

console.log(`Built ${path.relative(repoRoot, debPath)}`);

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

async function installText(filePath, content, mode) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, { mode });
  await chmod(filePath, mode);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function debArch(nodeArch) {
  if (nodeArch === "x64") {
    return "amd64";
  }
  if (nodeArch === "arm64") {
    return "arm64";
  }
  throw new Error(`Unsupported architecture for deb packaging: ${nodeArch}`);
}
