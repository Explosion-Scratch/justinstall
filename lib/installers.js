const fs = require("fs");
const path = require("path");
const os = require("os");
const { safeExecSync } = require("./utils");
const { extractName } = require("./config");

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
      return safeExecSync(cmd, [], { stdio: "ignore" }).length > 0;
    } catch (e) {
      return false;
    }
  };

  return {
    deb: process.platform === "linux" && ebool("which dpkg"),
    dmg: process.platform === "darwin",
    pkg: process.platform === "darwin",
    app: process.platform === "darwin",
    rpm: process.platform === "linux" && ebool("which rpm"),
    "tar.zst": ebool("which unzstd") || ebool("which zstd"),
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

  // If we have assets with installable extensions, prioritize them
  // This helps with websites that don't include platform indicators in filenames
  const installableExtensions = ["pkg", "dmg", "app", "deb", "rpm", "tar.gz", "zip", "tar.zst", "AppImage", "exe", "msi", "tar.bz2", "tar.xz", "7z"];
  const installableAssets = compatible.filter(asset =>
    installableExtensions.includes(asset.extension)
  );

  if (installableAssets.length > 0) {
    return installableAssets[0];
  }

  return compatible[0] || null;
};

const extractArchive = (filePath, outputDir, extension) => {
  switch (extension) {
    case "tar.gz":
      safeExecSync("tar", ["-xzf", filePath, "--directory", outputDir]);
      break;
    case "tar.xz":
      safeExecSync("tar", ["-xJf", filePath, "--directory", outputDir]);
      break;
    case "tar.bz2":
      safeExecSync("tar", ["-xjf", filePath, "--directory", outputDir]);
      break;
    case "zip":
      safeExecSync("unzip", [filePath, "-d", outputDir]);
      break;
    case "tar.zst":
      safeExecSync("sh", ["-c", `unzstd < ${JSON.stringify(filePath)} | tar -xf - --directory ${JSON.stringify(outputDir)}`]);
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
    appDirectories = safeExecSync(
      "find", [path.resolve(dir), "-maxdepth", "2", "-type", "d", "-name", "*.app"]
    )
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((i) => i.replace(path.resolve(dir) + path.sep, ""))
      // Filter out __MACOSX directories which contain only metadata
      .filter((i) => !i.includes("__MACOSX"));
  } catch {
    // Ignore find errors
  }

  // Then find all files
  const allFiles = safeExecSync(
    "find", [path.resolve(dir), "-type", "f", "!", "-size", "0"]
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

      const filePath = path.resolve(dir, f);
      const fileOutput = safeExecSync("file", [filePath]).toString();

      // Check if it's an executable binary or script
      return fileOutput.includes("executable") ||
        fileOutput.includes("ELF") ||
        fileOutput.includes("Mach-O") ||
        fileOutput.includes("script");
    } catch {
      return false;
    }
  };

  // Also check for files that look like binaries based on naming patterns
  const looksLikeBinary = (f) => {
    const filename = path.basename(f).toLowerCase();
    const dirname = path.dirname(f).toLowerCase();

    // Skip files in common non-binary directories
    if (dirname.includes("doc") || dirname.includes("docs") || dirname.includes("man") ||
      dirname.includes("runtime") || dirname.includes("lib") || dirname.includes("share")) {
      return false;
    }

    // Skip obvious non-binary files
    if (filename.includes("readme") || filename.includes("license") ||
      filename.includes("changelog") || filename.includes("copying") ||
      filename.includes("install") || filename.includes("makefile") ||
      filename.includes("notice") || filename.includes(".md") ||
      filename.includes(".txt") || filename.includes(".1") ||
      filename.includes(".json") || filename.includes(".yaml") ||
      filename.includes(".yml") || filename.includes(".toml") ||
      filename.includes(".cfg") || filename.includes(".conf") ||
      filename.includes(".ini")) {
      return false;
    }

    // Common binary naming patterns
    const binaryPatterns = [
      /^[a-z0-9_-]+$/,  // Simple name like hx, git, node
      /^[a-z0-9_-]+\.(exe|bin|run)$/,  // Extensions
    ];

    return binaryPatterns.some(pattern => pattern.test(filename));
  };

  const executableFiles = allFiles.filter(f => isExecutable(f) && looksLikeBinary(f));
  const potentialBinaries = allFiles.filter(f => looksLikeBinary(f) && !executableFiles.includes(f));

  // Combine and remove duplicates
  binaries.push(...executableFiles);
  binaries.push(...potentialBinaries);

  return [...new Set(binaries)]; // Remove duplicates
};

/**
 * Prompt user to choose from multiple binaries found in a package
 * @param {string[]} binaries - List of binary files found
 * @param {string} packageName - Name of the package being installed
 * @param {Object} logger - Logger instance
 * @returns {Promise<string[]>} Selected binaries
 */
const selectBinaries = async (binaries, packageName, logger = null, yesFlag = false) => {
  if (binaries.length <= 1) {
    return binaries;
  }

  // Filter out obvious non-binaries for cleaner selection
  const filteredBinaries = binaries.filter(f => {
    const filename = path.basename(f).toLowerCase();
    return !filename.includes('readme') &&
      !filename.includes('license') &&
      !filename.includes('changelog') &&
      !filename.includes('notice') &&
      !filename.includes('.md') &&
      !filename.includes('.txt') &&
      !filename.includes('.1') && // man pages
      !f.includes('doc/') &&
      !f.includes('docs/') &&
      !f.includes('man/');
  });

  // If filtering leaves us with just one, use it
  if (filteredBinaries.length === 1) {
    if (logger) {
      logger.log(`Auto-selected binary: ${filteredBinaries[0]}`);
    }
    return filteredBinaries;
  }

  // If filtering leaves none, fall back to original list
  const binariesToChoose = filteredBinaries.length > 0 ? filteredBinaries : binaries;

  if (logger) {
    logger.log(`Multiple binaries found in ${packageName}. Please choose which to install:`);
    binariesToChoose.forEach((binary, index) => {
      logger.log(`  ${index + 1}. ${binary}`);
    });
  }

  const readline = require('readline');
  const rli = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const choice = yesFlag ? '1' : await new Promise((resolve) => {
    rli.question(`Enter binary number to install (1-${binariesToChoose.length}), or 'all' for all: `, (ans) => {
      rli.close();
      resolve(ans.trim().toLowerCase());
    });
  });

  if (choice === 'all') {
    return binariesToChoose;
  }

  const numericChoice = parseInt(choice);
  if (numericChoice >= 1 && numericChoice <= binariesToChoose.length) {
    return [binariesToChoose[numericChoice - 1]];
  }

  // Default to first binary if invalid choice
  if (logger) {
    logger.log(`Invalid choice, installing first binary: ${binariesToChoose[0]}`);
  }
  return [binariesToChoose[0]];
};

// Use extractName from config for consistent name normalization

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
  logger,
  isMountedVolume = false,
  yesFlag = false
) => {
  // If an .app bundle was extracted from the archive, install it as a macOS app
  const appBundle = binaries.find((f) => f.toLowerCase().endsWith(".app"));
  if (appBundle && process.platform === "darwin") {
    if (logger) {
      logger.log(`Installing .app bundle from archive: ${appBundle}`);
    }
    const destinations = await installApp(appBundle, outputDir, checkPathFn, logger, yesFlag);
    return {
      method: "archive_app",
      destinations,
      binaries: [appBundle],
    };
  }

  // Look for DMG or PKG files in the extracted binaries
  const dmgFile = binaries.find((f) => f.toLowerCase().endsWith(".dmg"));
  const pkgFile = binaries.find((f) => f.toLowerCase().endsWith(".pkg"));

  if (dmgFile) {
    logger.log(`Found DMG file in ZIP: ${dmgFile}`);
    const dmgPath = path.join(outputDir, dmgFile);
    const mountDir = path.join(outputDir, "dmg-mount");
    fs.mkdirSync(mountDir, { recursive: true });

    try {
      mountDMG(dmgPath, mountDir, logger);
      const dmgBinaries = getBinaries(mountDir);
      logger.debug(
        `Found ${dmgBinaries.length} items in DMG: ${dmgBinaries.join(", ")}`
      );

      const appFile = dmgBinaries.find((f) => f.endsWith(".app"));
      const nestedPkgFile = dmgBinaries.find((f) => f.endsWith(".pkg"));

      if (appFile) {
        logger.log(`Installing .app bundle from DMG: ${appFile}`);
        const destinations = await installApp(appFile, mountDir, checkPathFn, logger, yesFlag);
        return {
          method: "dmg_app",
          destinations,
          binaries: [appFile],
        };
      } else if (nestedPkgFile) {
        logger.log(`Installing .pkg file from DMG: ${nestedPkgFile}`);
        const destinations = installPkg(path.join(mountDir, nestedPkgFile));
        return {
          method: "dmg_pkg",
          destinations,
          binaries: [nestedPkgFile],
        };
      } else if (dmgBinaries.length > 0) {
        logger.log("No .app or .pkg found in DMG, trying to install executables");
        const selectedBinaries = await selectBinaries(dmgBinaries, selectedName, logger);
        const destinations = await installBinaries(
          selectedBinaries,
          mountDir,
          selectedName,
          checkPathFn,
          logger,
          true // isMountedVolume = true
        );
        return {
          method: "dmg_binaries",
          destinations,
          binaries: selectedBinaries.map((bin) => path.basename(bin)),
        };
      } else {
        throw new Error("No installable files found in DMG");
      }
    } finally {
      ejectDMG(mountDir, logger);
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

const installApp = async (appPath, outputDir, checkPathFn, logger = null, yesFlag = false) => {
  const original = path.basename(appPath);
  const cleanedBase = extractName({ name: original }) || original.replace(/\.app$/i, "");
  const cleaned = cleanedBase.replace(/\.app$/i, "");
  const dest = path.join("/Applications", `${cleaned}.app`);
  await checkPathFn(dest);

  // Use rsync to preserve all file attributes, permissions, and symlinks
  try {
    safeExecSync("rsync", ["-a", "--copy-links", "--protect-args", `${path.join(outputDir, appPath)}/`, dest]);
  } catch (e) {
    // Fallback to fs.cpSync if rsync fails
    if (logger) {
      logger.warn(`rsync failed, falling back to fs.cpSync: ${e.message}`);
    }
    fs.cpSync(path.join(outputDir, appPath), dest, { recursive: true, preserveTimestamps: true });
  }

  // Code sign
  try {
    safeExecSync("codesign", ["--sign", "-", "--force", "--deep", dest], { stdio: "pipe" });
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
    safeExecSync("xattr", ["-rd", "com.apple.quarantine", dest], { stdio: "pipe" });
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
  safeExecSync("sudo", ["installer", "-pkg", pkgPath, "-target", "/"]);
  return ["System-wide package installation"];
};

const mountDMG = (dmgPath, mountPoint, logger = null) => {
  try {
    // Ensure mount point is empty
    if (fs.existsSync(mountPoint)) {
      fs.rmSync(mountPoint, { recursive: true, force: true });
    }
    fs.mkdirSync(mountPoint, { recursive: true });

    safeExecSync("hdiutil", ["attach", dmgPath, "-nobrowse", "-mountpoint", mountPoint]);

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
    safeExecSync("hdiutil", ["eject", mountPoint]);
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
      safeExecSync("hdiutil", ["eject", mountPoint, "-force"]);
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
  isMountedVolume = false,
  yesFlag = false
) => {
  const destinations = [];

  for (const binary of binaries) {
    const binaryPath = path.join(outputDir, binary);
    const cleanName = path.basename(binary);
    const dest = path.join(os.homedir(), ".local", "bin", cleanName);

    await checkPathFn(dest, yesFlag);

    // Don't try to chmod files on mounted volumes (like DMGs)
    if (!isMountedVolume) {
      try {
        safeExecSync("chmod", ["+x", binaryPath]);
      } catch (e) {
        if (logger) {
          logger.warn(`Failed to make ${binary} executable: ${e.message}`);
        }
      }
    }

    fs.cpSync(binaryPath, dest);

    // Make sure the copied file is executable
    try {
      safeExecSync("chmod", ["+x", dest]);
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
  safeExecSync("sudo", ["dpkg", "-i", debPath]);
  return ["System-wide deb installation"];
};


module.exports = {
  getPlatformInfo,
  getInstallCapabilities,
  selectBestAsset,
  extractArchive,
  getBinaries,
  selectBinaries,
  processExtractedPackages,
  installApp,
  installPkg,
  mountDMG,
  ejectDMG,
  installBinaries,
  installDeb,
};
