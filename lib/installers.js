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

      // Extra boost for DMGs/PKGs that match architecture
      if (asset.extension === "dmg" || asset.extension === "pkg") {
        // Check if asset name contains architecture indicators
        const archTerms = myArch.filter((arch) =>
          asset.segments.some(
            (segment) =>
              segment.includes(arch.toLowerCase()) ||
              arch.toLowerCase().includes(segment)
          )
        );

        asset.points += archTerms.length * 0.5 + 1;
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
  // First, find .app directories (these are app bundles on macOS)
  let appDirectories = [];
  try {
    appDirectories = execSync(
      `find ${JSON.stringify(
        path.resolve(dir)
      )} -maxdepth 2 -type d -name "*.app"`
    )
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((i) => i.replace(path.resolve(dir) + path.sep, ""));
  } catch {
    // Ignore find errors
  }

  // Then find all files
  const allFiles = execSync(
    `find ${JSON.stringify(path.resolve(dir))} -type f ! -size 0`
  )
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((i) => i.replace(path.resolve(dir) + path.sep, ""));

  let binaries = [];
  const ALLOWED_EXTENSIONS = [".deb", ".rpm", ".dmg", ".pkg", ".zip", ".gz"];

  // Add .app directories first (they take priority)
  binaries.push(...appDirectories);

  // Add files with allowed extensions
  binaries.push(
    ...allFiles.filter((i) =>
      ALLOWED_EXTENSIONS.find((j) => i.toLowerCase().endsWith(j))
    )
  );

  // Add executable files (but exclude files inside .app bundles)
  const isExecutable = (f) => {
    try {
      // Skip files inside .app bundles since we already have the .app
      if (appDirectories.some((app) => f.startsWith(app + "/"))) {
        return false;
      }
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

/**
 * Process extracted packages (DMG/PKG) found within ZIP archives
 * @param {string[]} binaries - List of files found by getBinaries
 * @param {string} outputDir - Directory containing extracted files
 * @param {string} selectedName - Name of the original selected file
 * @param {Function} checkPathFn - Function to check destination paths
 * @param {Object} logger - Logger instance
 * @returns {Object|null} Installation result or null if no packages found
 */
const processExtractedPackages = async (
  binaries,
  outputDir,
  selectedName,
  checkPathFn,
  logger
) => {
  // Look for DMG or PKG files in the extracted binaries
  const dmgFile = binaries.find((f) => f.toLowerCase().endsWith(".dmg"));
  const pkgFile = binaries.find((f) => f.toLowerCase().endsWith(".pkg"));

  if (dmgFile) {
    logger.log(`Found DMG file in ZIP: ${dmgFile}`);
    const dmgPath = path.join(outputDir, dmgFile);

    try {
      mountDMG(dmgPath, outputDir, logger);
      const dmgBinaries = getBinaries(outputDir);
      logger.debug(
        `Found ${dmgBinaries.length} items in DMG: ${dmgBinaries.join(", ")}`
      );

      const appFile = dmgBinaries.find((f) => f.endsWith(".app"));
      const nestedPkgFile = dmgBinaries.find((f) => f.endsWith(".pkg"));

      if (appFile) {
        logger.log(`Installing .app bundle from DMG: ${appFile}`);
        const destinations = await installApp(appFile, outputDir, checkPathFn, logger);
        return {
          method: "dmg_app",
          destinations,
          binaries: [appFile],
        };
      } else if (nestedPkgFile) {
        logger.log(`Installing .pkg file from DMG: ${nestedPkgFile}`);
        const destinations = installPkg(path.join(outputDir, nestedPkgFile));
        return {
          method: "dmg_pkg",
          destinations,
          binaries: [nestedPkgFile],
        };
      } else if (dmgBinaries.length > 0) {
        logger.log("No .app or .pkg found in DMG, trying to install executables");
        const destinations = await installBinaries(
          dmgBinaries,
          outputDir,
          selectedName,
          checkPathFn,
          logger,
          true // isMountedVolume = true
        );
        return {
          method: "dmg_binaries",
          destinations,
          binaries: dmgBinaries.map((bin) => path.basename(bin)),
        };
      } else {
        throw new Error("No installable files found in DMG");
      }
    } finally {
      ejectDMG(outputDir, logger);
    }
  } else if (pkgFile) {
    logger.log(`Found PKG file in ZIP: ${pkgFile}`);
    const pkgPath = path.join(outputDir, pkgFile);
    const destinations = installPkg(pkgPath);
    return {
      method: "pkg",
      destinations,
      binaries: [pkgFile],
    };
  }

  return null; // No packages found
};

const installApp = async (appPath, outputDir, checkPathFn, logger = null) => {
  const dest = path.join("/Applications", path.basename(appPath));
  await checkPathFn(dest);

  fs.cpSync(path.join(outputDir, appPath), dest, { recursive: true });

  // Code sign
  try {
    execSync(
      `codesign --sign - --force --deep ${JSON.stringify(dest)} 2> /dev/null`
    );
    if (logger) {
      logger.debug(`Successfully codesigned ${dest}`);
    }
  } catch (e) {
    if (logger) {
      logger.warn("Codesigning failed - app may show security warnings");
    }
  }

  // Remove quarantine
  try {
    execSync(
      `xattr -rd com.apple.quarantine ${JSON.stringify(dest)} 2> /dev/null`
    );
    if (logger) {
      logger.debug(`Removed quarantine from ${dest}`);
    }
  } catch (e) {
    if (logger) {
      logger.warn("Dequarantining failed - app may show security warnings");
    }
  }

  return [dest];
};

const installPkg = (pkgPath) => {
  execSync(`sudo installer -pkg ${JSON.stringify(pkgPath)} -target /`);
  return ["System-wide package installation"];
};

const mountDMG = (dmgPath, mountPoint, logger = null) => {
  try {
    execSync(
      `hdiutil attach ${JSON.stringify(
        dmgPath
      )} -nobrowse -mountpoint ${JSON.stringify(mountPoint)}`
    );

    if (!fs.existsSync(mountPoint)) {
      throw new Error(
        `Failed to mount DMG: mount point ${mountPoint} does not exist`
      );
    }

    if (logger) {
      logger.debug(`Successfully mounted DMG at: ${mountPoint}`);
    }
  } catch (error) {
    throw new Error(`Failed to mount DMG ${dmgPath}: ${error.message}`);
  }
};

const ejectDMG = (mountPoint, logger = null) => {
  try {
    execSync(`hdiutil eject ${JSON.stringify(mountPoint)}`);
    if (logger) {
      logger.debug(`Successfully ejected DMG at: ${mountPoint}`);
    }
  } catch (e) {
    if (logger) {
      logger.warn(
        `Warning: Failed to eject DMG at ${mountPoint}: ${e.message}`
      );
    }
    // Try force eject as fallback
    try {
      execSync(`hdiutil eject ${JSON.stringify(mountPoint)} -force`);
      if (logger) {
        logger.debug(`Force ejected DMG at: ${mountPoint}`);
      }
    } catch (forceError) {
      if (logger) {
        logger.warn(`Warning: Force eject also failed: ${forceError.message}`);
      }
    }
  }
};

const installBinaries = async (
  binaries,
  outputDir,
  selectedName,
  checkPathFn,
  logger = null,
  isMountedVolume = false
) => {
  const destinations = [];

  for (const binary of binaries) {
    const binaryPath = path.join(outputDir, binary);
    const cleanName = cleanBinaryName(selectedName);
    const dest = path.join(os.homedir(), ".local", "bin", cleanName);

    await checkPathFn(dest);

    // Don't try to chmod files on mounted volumes (like DMGs)
    if (!isMountedVolume) {
      try {
        execSync(`chmod +x ${JSON.stringify(binaryPath)}`);
      } catch (e) {
        if (logger) {
          logger.warn(`Failed to make ${binary} executable: ${e.message}`);
        }
      }
    }

    fs.cpSync(binaryPath, dest);

    // Make sure the copied file is executable
    try {
      execSync(`chmod +x ${JSON.stringify(dest)}`);
    } catch (e) {
      if (logger) {
        logger.warn(`Failed to make copied binary executable: ${e.message}`);
      }
    }

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
  processExtractedPackages,
  installApp,
  installPkg,
  mountDMG,
  ejectDMG,
  installBinaries,
  installDeb,
  cleanBinaryName,
};
