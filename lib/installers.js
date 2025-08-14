const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const getPlatformInfo = () => {
  const arch = process.arch;
  const platform = process.platform;

  const archAliases = {
    arm64: ["arm64", "arm", "aarch", "aarch64", "aar64", "silicon"],
    x64: ["x64", "intel", "x86_64"],
    universal: ["universal", "all"],
  };

  const platformAliases = {
    darwin: ["darwin", "osx", "macos", "mac", "apple"],
    linux: ["linux"],
    freebsd: ["freebsd", "linux"],
    openbsd: ["openbsd", "linux"],
    win32: ["win32", "win", "windows"],
    universal: archAliases.universal,
  };

  const boosters = {
    darwin: ["pkg", "dmg"],
    linux: ["AppImage"],
  };

  const myArch = [
    arch,
    ...(platform === "darwin" ? ["m1", "m2", "m3"] : []),
    ...(archAliases[arch] || archAliases.universal),
  ];

  const myPlatform = [
    platform,
    ...(platformAliases[platform] || platformAliases.universal),
  ];

  return {
    arch,
    platform,
    myArch,
    myPlatform,
    boosters,
    archAliases,
    platformAliases,
  };
};

const getInstallCapabilities = () => {
  const ebool = (cmd) => {
    try {
      return execSync(cmd, { stdio: "ignore" }).length > 0;
    } catch (e) {
      return false;
    }
  };

  return {
    deb: process.platform === "linux" && ebool("which apt"),
    dmg: process.platform === "darwin",
    pkg: process.platform === "darwin",
    app: process.platform === "darwin",
    rpm: ebool("which dnf"),
    "tar.zst": ebool("which pacman"),
  };
};

const selectBestAsset = (assets, platformInfo, capabilities) => {
  const { myArch, myPlatform, boosters } = platformInfo;
  const { platform } = platformInfo;

  const possible = {
    platforms: Object.values(platformInfo.platformAliases).flat(),
    arches: Object.values(platformInfo.archAliases).flat(),
  };

  const incl = (a, b) => a.find((i) => b.includes(i));

  let compatible = assets
    .map((asset) => {
      const compatiblePlatforms = asset.segments.filter((j) =>
        possible.platforms.includes(j)
      );
      const compatibleArches = asset.segments.filter((j) =>
        possible.arches.includes(j)
      );

      asset.points = 0;
      asset.compatiblePlatforms = compatiblePlatforms;
      asset.compatibleArches = compatibleArches;

      // Boost preferred formats for platform
      if (boosters[platform]) {
        for (let i of boosters[platform]) {
          if (asset.name.includes(i)) {
            asset.points += 0.1;
          }
        }
      }

      // Platform compatibility
      if (compatiblePlatforms.length) {
        if (incl(compatiblePlatforms, myPlatform)) {
          asset.points += 1;
        } else {
          asset.delete = true;
        }
      }

      // Architecture compatibility
      if (compatibleArches.length) {
        if (incl(compatibleArches, myArch)) {
          asset.points += 1;
        } else {
          asset.delete = true;
        }
      }

      // Installation capability check
      if (capabilities[asset.extension] === false) {
        asset.delete = true;
      }

      if (asset.segments.includes("pkgbuild") && !capabilities["tar.zst"]) {
        asset.delete = true;
      }

      return asset;
    })
    .filter((i) => !i.delete)
    .sort((a, b) => b.points - a.points);

  return compatible[0] || null;
};

const extractArchive = (filePath, outputDir, extension) => {
  switch (extension) {
    case "tar.gz":
      execSync(
        `tar -xzf ${JSON.stringify(filePath)} --directory ${JSON.stringify(
          outputDir
        )}`
      );
      break;
    case "zip":
      execSync(
        `unzip ${JSON.stringify(filePath)} -d ${JSON.stringify(outputDir)}`
      );
      break;
    case "tar.zst":
      execSync(
        `tar -xf ${JSON.stringify(filePath)} --directory ${JSON.stringify(
          outputDir
        )}`
      );
      break;
    default:
      // For files without known extensions, just copy them
      const filename = path.basename(filePath);
      fs.renameSync(filePath, path.join(outputDir, filename));
  }
};

const getBinaries = (dir) => {
  const allFiles = execSync(
    `find ${JSON.stringify(path.resolve(dir))} -type f ! -size 0`
  )
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((i) => i.replace(path.resolve(dir) + path.sep, ""));

  let binaries = [];
  const ALLOWED_EXTENSIONS = [
    ".deb",
    ".rpm",
    ".dmg",
    ".pkg",
    ".app",
    ".zip",
    ".gz",
  ];

  // Add files with allowed extensions
  binaries.push(
    ...allFiles.filter((i) =>
      ALLOWED_EXTENSIONS.find((j) => i.toLowerCase().endsWith(j))
    )
  );

  // Add executable files
  const isExecutable = (f) => {
    try {
      return execSync(`file ${JSON.stringify(path.resolve(dir, f))}`).includes(
        "executable"
      );
    } catch {
      return false;
    }
  };

  binaries.push(...allFiles.filter(isExecutable));

  return [...new Set(binaries)]; // Remove duplicates
};

const installApp = async (appPath, outputDir, checkPathFn) => {
  const dest = path.join("/Applications", path.basename(appPath));
  await checkPathFn(dest);

  fs.cpSync(path.join(outputDir, appPath), dest, { recursive: true });

  // Code sign
  try {
    execSync(
      `codesign --sign - --force --deep ${JSON.stringify(dest)} 2> /dev/null`
    );
  } catch (e) {
    console.warn("Codesigning failed");
  }

  // Remove quarantine
  try {
    execSync(
      `xattr -rd com.apple.quarantine ${JSON.stringify(dest)} 2> /dev/null`
    );
  } catch (e) {
    console.warn("Dequarantining failed");
  }

  return [dest];
};

const installPkg = (pkgPath) => {
  execSync(`sudo installer -pkg ${JSON.stringify(pkgPath)} -target /`);
  return ["System-wide package installation"];
};

const mountDMG = (dmgPath, mountPoint) => {
  execSync(
    `hdiutil attach ${JSON.stringify(
      dmgPath
    )} -nobrowse -mountpoint ${JSON.stringify(mountPoint)}`
  );
};

const ejectDMG = (mountPoint) => {
  try {
    execSync(`hdiutil eject ${JSON.stringify(mountPoint)} 2> /dev/null`);
  } catch (e) {
    // Ignore eject errors
  }
};

const installBinaries = async (
  binaries,
  outputDir,
  selectedName,
  checkPathFn
) => {
  const destinations = [];

  for (const binary of binaries) {
    const binaryPath = path.join(outputDir, binary);
    const cleanName = cleanBinaryName(selectedName);
    const dest = path.join(os.homedir(), ".local", "bin", cleanName);

    await checkPathFn(dest);
    execSync(`chmod +x ${JSON.stringify(binaryPath)}`);
    fs.cpSync(binaryPath, dest);
    destinations.push(dest);
  }

  return destinations;
};

const installDeb = (debPath) => {
  execSync(`dpkg -i ${JSON.stringify(debPath)}`);
  return ["System-wide deb installation"];
};

const cleanBinaryName = (name) => {
  return name
    .replace(/\.(tar\.gz|zip|dmg|pkg|deb|app)$/i, "")
    .replace(/v?[0-9]+\.[0-9]+\.[0-9]+/i, "")
    .replace(
      /(?:darwin|linux|windows|mac|osx|x64|arm64|aarch64|universal)/gi,
      ""
    )
    .replace(/[ _\-\.]+$/, "")
    .replace(/^[ _\-\.]+/, "");
};

module.exports = {
  getPlatformInfo,
  getInstallCapabilities,
  selectBestAsset,
  extractArchive,
  getBinaries,
  installApp,
  installPkg,
  mountDMG,
  ejectDMG,
  installBinaries,
  installDeb,
  cleanBinaryName,
};
