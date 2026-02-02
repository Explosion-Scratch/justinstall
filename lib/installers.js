const fs = require("fs");
const path = require("path");
const os = require("os");
const { safeExecSync } = require("./utils");
const { extractName } = require("./config");
const { isIgnored } = require("./sources");
const { 
  getExtension, 
  getInstallCapabilities, 
  extractArchive, 
  isInstallable,
  getBoostedExtensions,
  scoreAssetByExtension,
  filterAssetsByExtensions,
  sortAssetsByExtension,
  isInstallerScriptExtension
} = require("./extensions");
const {
  detectInstallerScripts,
  findBestInstallerScript,
  executeInstallerScript,
  previewInstallerScript,
  isInstallerScriptCompatible
} = require("./installer-scripts");

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
    darwin: getBoostedExtensions("darwin"),
    linux: getBoostedExtensions("linux"),
    win32: getBoostedExtensions("win32"),
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

// Use getInstallCapabilities from extensions module

const selectBestAsset = (assets, platformInfo, capabilities, firstFlag = false) => {
  const { myArch, myPlatform } = platformInfo;
  const { platform } = platformInfo;

  const possible = {
    platforms: Object.values(platformInfo.platformAliases).flat(),
    arches: Object.values(platformInfo.archAliases).flat(),
  };

  const incl = (a, b) => a.find((i) => b.includes(i));

  let compatible = assets
    .map((asset) => {
      const compatiblePlatforms = asset.segments.filter((j) =>
        possible.platforms.includes(j),
      );
      const compatibleArches = asset.segments.filter((j) =>
        possible.arches.includes(j),
      );

      asset.points = 0;
      asset.compatiblePlatforms = compatiblePlatforms;
      asset.compatibleArches = compatibleArches;

      // Add extension-based scoring using unified system
      const extensionScore = scoreAssetByExtension(asset, platform, capabilities);
      if (extensionScore < 0) {
        asset.delete = true; // Incompatible extension
      } else {
        asset.points += extensionScore;
      }

      // Platform compatibility - HIGHEST PRIORITY
      if (compatiblePlatforms.length) {
        if (incl(compatiblePlatforms, myPlatform)) {
          asset.points += 3; // Increased from 1 to 3

          // Significant bonus for platform-specific assets without extensions when using --first
          // This prioritizes direct binaries like "yt-dlp_macos" over archives like .zip
          if (!asset.extension) {
            if (firstFlag) {
              asset.points += 10; // Much higher bonus when --first flag is used
            } else {
              asset.points += 8; // Increased bonus to prioritize binaries over archives
            }
          }
        } else {
          asset.delete = true;
        }
      }

      // Architecture compatibility - LOWER PRIORITY
      if (compatibleArches.length) {
        if (incl(compatibleArches, myArch)) {
          asset.points += 1;
        } else {
          asset.delete = true;
        }
      }

      // Additional compatibility checks
      if (asset.segments.includes("pkgbuild") && !capabilities["tar.zst"]) {
        asset.delete = true;
      }

      return asset;
    })
    .filter((i) => !i.delete)
    .sort((a, b) => b.points - a.points);

  // Use unified extension filtering and sorting
  const extensionFiltered = filterAssetsByExtensions(compatible, platform, capabilities);
  const extensionSorted = sortAssetsByExtension(extensionFiltered, platform, capabilities);

  // Prioritize assets with platform matches over arch-only matches
  const platformSpecificAssets = extensionSorted.filter(
    (asset) => asset.compatiblePlatforms.length > 0,
  );

  if (platformSpecificAssets.length > 0) {
    return platformSpecificAssets[0];
  }

  // Return the highest scoring asset (already sorted by extension preference)
  return extensionSorted[0] || null;
};

// Use extractArchive from extensions module

const getBinaries = (dir) => {
  // First, find .app directories (these are app bundles on macOS)
  let appDirectories = [];
  try {
    appDirectories = safeExecSync("find", [
      path.resolve(dir),
      "-maxdepth",
      "2",
      "-type",
      "d",
      "-name",
      "*.app",
    ])
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
  const allFiles = safeExecSync("find", [
    path.resolve(dir),
    "-type",
    "f",
    "!",
    "-size",
    "0",
  ])
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((i) => i.replace(path.resolve(dir) + path.sep, ""))
    .filter((i) => !isIgnored(i));

  let binaries = [];
  const ALLOWED_EXTENSIONS = [".deb", ".rpm", ".dmg", ".pkg", ".zip", ".gz"];
  const INSTALLER_SCRIPT_EXTENSIONS = [".command", ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1"];

  // Add .app directories first (they take priority)
  binaries.push(...appDirectories);

  // Add files with allowed extensions
  binaries.push(
    ...allFiles.filter(
      (i) =>
        ALLOWED_EXTENSIONS.find((j) => i.toLowerCase().endsWith(j)) &&
        !isIgnored(i),
    ),
  );

  // Add installer scripts (platform-compatible ones only)
  binaries.push(
    ...allFiles.filter((i) => {
      const ext = path.extname(i).slice(1).toLowerCase();
      return isInstallerScriptExtension(ext) && 
             isInstallerScriptCompatible(ext) &&
             !isIgnored(i);
    }),
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
      return (
        fileOutput.includes("executable") ||
        fileOutput.includes("ELF") ||
        fileOutput.includes("Mach-O") ||
        fileOutput.includes("script")
      );
    } catch {
      return false;
    }
  };

  // Also check for files that look like binaries based on naming patterns
  const looksLikeBinary = (f) => {
    const filename = path.basename(f).toLowerCase();
    const dirname = path.dirname(f).toLowerCase();

    // Skip files in common non-binary directories
    if (
      dirname.includes("doc") ||
      dirname.includes("docs") ||
      dirname.includes("man") ||
      dirname.includes("runtime") ||
      dirname.includes("lib") ||
      dirname.includes("share") ||
      dirname.includes("_internal")
    ) {
      return false;
    }

    // Skip obvious non-binary files
    if (
      filename.includes("readme") ||
      filename.includes("license") ||
      filename.includes("changelog") ||
      filename.includes("copying") ||
      filename.includes("install") ||
      filename.includes("makefile") ||
      filename.includes("notice") ||
      filename.includes(".md") ||
      filename.includes(".txt") ||
      filename.includes(".1") ||
      filename.includes(".json") ||
      filename.includes(".yaml") ||
      filename.includes(".yml") ||
      filename.includes(".toml") ||
      filename.includes(".cfg") ||
      filename.includes(".conf") ||
      filename.includes(".ini")
    ) {
      return false;
    }

    // Common binary naming patterns
    const binaryPatterns = [
      /^[a-z0-9_-]+$/, // Simple name like hx, git, node
      /^[a-z0-9_-]+\.(exe|bin|run)$/, // Extensions
    ];

    return binaryPatterns.some((pattern) => pattern.test(filename));
  };

  const executableFiles = allFiles.filter(
    (f) => isExecutable(f) && looksLikeBinary(f) && !isIgnored(f),
  );
  const potentialBinaries = allFiles.filter(
    (f) => looksLikeBinary(f) && !executableFiles.includes(f) && !isIgnored(f),
  );

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
/**
 * Prompt user to choose from multiple binaries found in a package
 * @param {string[]} binaries - List of binary files found
 * @param {string} packageName - Name of the package being installed
 * @param {Object} logger - Logger instance
 * @returns {Promise<string[]>} Selected binaries
 */
const selectBinaries = async (
  binaries,
  packageName,
  logger = null,
  yesFlag = false,
) => {
  if (binaries.length <= 1) {
    return binaries;
  }

  // Helper to score binaries based on name and location
  const scoreBinary = (binaryPath) => {
    let score = 0;
    const filename = path.basename(binaryPath).toLowerCase();
    const dirname = path.dirname(binaryPath).toLowerCase();
    const cleanPackageName = extractName({ name: packageName }).toLowerCase();

    // High penalty for completion scripts
    if (
      dirname.includes("completion") || 
      dirname.includes("completions") ||
      filename.endsWith(".bash") ||
      filename.endsWith(".zsh") ||
      filename.endsWith(".fish") ||
      filename.endsWith(".csh") ||
      filename.endsWith("completion")
    ) {
      return -100;
    }
    
    // Penalty for other non-primary scripts
    if (filename.endsWith(".sh") || filename.endsWith(".bat") || filename.endsWith(".ps1")) {
      score -= 20;
    }

    // Major Boost for exact match with package name
    // e.g. "gum" matches "gum"
    if (filename === cleanPackageName) {
      score += 100;
    }

    // Boost for name containing package name (e.g. "gum-cli")
    else if (filename.includes(cleanPackageName)) {
      score += 50;
    }
    
    // Penalize documentation/garbage
    if (
      filename.includes("readme") ||
      filename.includes("license") ||
      filename.includes("changelog") ||
      filename.includes("notice") ||
      filename.includes(".md") ||
      filename.includes(".txt") ||
      filename.includes(".1") || // man pages
      binaryPath.includes("doc/") ||
      binaryPath.includes("docs/") ||
      binaryPath.includes("man/")
    ) {
      score -= 100;
    }
    


    return score;
  };

  // Sort binaries by score
  const sortedBinaries = [...binaries].sort((a, b) => {
    const scoreA = scoreBinary(a);
    const scoreB = scoreBinary(b);
    return scoreB - scoreA;
  });

  // Filter out heavily penalized items if we have good candidates
  let binariesToChoose = sortedBinaries;
  const bestScore = scoreBinary(sortedBinaries[0]);
  
  if (bestScore > 0) {
    // If we have a good candidate, strictly filter out negative scoring items (completions, docs)
    // unless they are the only options
    const goodBinaries = sortedBinaries.filter(b => scoreBinary(b) > -10);
    if (goodBinaries.length > 0) {
      binariesToChoose = goodBinaries;
    }
  }

  // If filtering leaves us with just one (or the top one is significantly better), use it
  if (binariesToChoose.length === 1 || (binariesToChoose.length > 0 && scoreBinary(binariesToChoose[0]) > 50 && scoreBinary(binariesToChoose[1] || "") < 0)) {
    if (logger) {
      logger.log(`Auto-selected binary: ${binariesToChoose[0]}`);
    }
    return [binariesToChoose[0]];
  }

  if (logger) {
    logger.log(
      `Multiple binaries found in ${packageName}. Please choose which to install:`,
    );
    binariesToChoose.forEach((binary, index) => {
      logger.log(`  ${index + 1}. ${binary}`);
    });
  }

  const readline = require("readline");
  const rli = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const choice = yesFlag
    ? "1"
    : await new Promise((resolve) => {
        rli.question(
          `Enter binary number to install (1-${binariesToChoose.length}), or 'all' for all: `,
          (ans) => {
            rli.close();
            resolve(ans.trim().toLowerCase());
          },
        );
      });

  if (choice === "all") {
    return binariesToChoose;
  }

  const numericChoice = parseInt(choice);
  if (numericChoice >= 1 && numericChoice <= binariesToChoose.length) {
    return [binariesToChoose[numericChoice - 1]];
  }

  // Default to first binary if invalid choice
  if (logger) {
    logger.log(
      `Invalid choice, installing first binary: ${binariesToChoose[0]}`,
    );
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
  yesFlag = false,
) => {
  // If an .app bundle was extracted from the archive, install it as a macOS app
  const appBundle = binaries.find((f) => f.toLowerCase().endsWith(".app"));
  if (appBundle && process.platform === "darwin") {
    if (logger) {
      logger.log(`Installing .app bundle from archive: ${appBundle}`);
    }
    const destinations = await installApp(
      appBundle,
      outputDir,
      checkPathFn,
      logger,
      yesFlag,
    );
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
        `Found ${dmgBinaries.length} items in DMG: ${dmgBinaries.join(", ")}`,
      );

      const appFile = dmgBinaries.find((f) => f.endsWith(".app"));
      const nestedPkgFile = dmgBinaries.find((f) => f.endsWith(".pkg"));

      if (appFile) {
        logger.log(`Installing .app bundle from DMG: ${appFile}`);
        const destinations = await installApp(
          appFile,
          mountDir,
          checkPathFn,
          logger,
          yesFlag,
        );
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
        logger.log(
          "No .app or .pkg found in DMG, trying to install executables",
        );
        const selectedBinaries = await selectBinaries(
          dmgBinaries,
          selectedName,
          logger,
        );
        const installResult = await installBinaries(
          selectedBinaries,
          mountDir,
          selectedName,
          checkPathFn,
          logger,
          true, // isMountedVolume = true
        );
        return {
          method: "dmg_binaries",
          destinations: installResult.destinations,
          binaries: installResult.cleanedBinaries,
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

  // Look for platform-specific installer scripts
  const installerScripts = detectInstallerScripts(binaries, outputDir);
  
  if (installerScripts.length > 0) {
    const { confirm, colors } = require("./utils");
    
    if (logger) {
      logger.log(`Found ${installerScripts.length} installer script(s) for your platform:`);
      installerScripts.forEach((script, index) => {
        logger.log(`  ${index + 1}. ${script.filename} (${script.config.description}, score: ${script.score})`);
      });
    }
    
    // Use the best matching script by default
    const bestScript = installerScripts[0];
    
    // Preview the script
    const preview = previewInstallerScript(bestScript.fullPath, 15);
    if (logger) {
      logger.log(`\n${colors.fg.cyan}Script preview (${bestScript.filename}):${colors.reset}`);
      logger.log(`${colors.fg.green}${preview}${colors.reset}\n`);
    }
    
    const runScript = await confirm(
      `Run installer script "${bestScript.filename}"?`,
      "y",
      yesFlag
    );
    
    if (runScript) {
      const result = executeInstallerScript(
        bestScript.fullPath,
        bestScript.extension,
        {},
        logger
      );
      
      return {
        method: result.method,
        destinations: [bestScript.fullPath],
        binaries: [bestScript.filename],
      };
    }
  }

  return null; // No packages found
};

const installApp = async (
  appPath,
  outputDir,
  checkPathFn,
  logger = null,
  yesFlag = false,
) => {
  const original = path.basename(appPath);
  const cleanedBase =
    extractName({ name: original }) || original.replace(/\.app$/i, "");
  const cleaned = cleanedBase.replace(/\.app$/i, "");
  const dest = path.join("/Applications", `${cleaned}.app`);
  await checkPathFn(dest);

  // Use rsync to preserve all file attributes, permissions, and symlinks
  try {
    safeExecSync("rsync", [
      "-a",
      "--copy-links",
      "--protect-args",
      `${path.join(outputDir, appPath)}/`,
      dest,
    ]);
  } catch (e) {
    // Fallback to fs.cpSync if rsync fails
    if (logger) {
      logger.warn(`rsync failed, falling back to fs.cpSync: ${e.message}`);
    }
    fs.cpSync(path.join(outputDir, appPath), dest, {
      recursive: true,
      preserveTimestamps: true,
    });
  }

  // Code sign
  try {
    safeExecSync("codesign", ["--sign", "-", "--force", "--deep", dest], {
      stdio: "pipe",
    });
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
    safeExecSync("xattr", ["-rd", "com.apple.quarantine", dest], {
      stdio: "pipe",
    });
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

const installPkg = (pkgPath, logger = null) => {
  const { requestSudoAccess } = require("./system");
  const { createInstallProgressBar } = require("./progress");
  const { colors } = require("./utils");

  const progress = createInstallProgressBar("Installing package");

  try {
    progress.start();
    progress.updateStatus(10, "Requesting administrator access...");

    const hasSudo = require("./system").checkSudoAccess(true);
    if (!hasSudo) {
      progress.stop();
      console.log(`${colors.fg.yellow}Administrator access required for package installation${colors.reset}`);
      console.log(`${colors.dim}Please enter your password when prompted${colors.reset}`);
    }

    progress.updateStatus(30, "Running installer...");

    safeExecSync("sudo", ["installer", "-pkg", pkgPath, "-target", "/"], {
      stdio: "inherit",
    });

    progress.updateStatus(90, "Verifying installation...");
    progress.complete(true);

    return ["System-wide package installation"];
  } catch (error) {
    progress.complete(false);
    throw new Error(`Package installation failed: ${error.message}`);
  }
};

const mountDMG = (dmgPath, mountPoint, logger = null) => {
  try {
    // Ensure mount point is empty
    if (fs.existsSync(mountPoint)) {
      fs.rmSync(mountPoint, { recursive: true, force: true });
    }
    fs.mkdirSync(mountPoint, { recursive: true });

    safeExecSync("hdiutil", [
      "attach",
      dmgPath,
      "-nobrowse",
      "-mountpoint",
      mountPoint,
    ]);

    if (!fs.existsSync(mountPoint)) {
      throw new Error(
        `Failed to mount DMG: mount point ${mountPoint} does not exist`,
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
        `Warning: Failed to eject DMG at ${mountPoint}: ${e.message}`,
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
  yesFlag = false,
) => {
  const destinations = [];
  const cleanedBinaries = [];

  for (const binary of binaries) {
    const binaryPath = path.join(outputDir, binary);
    const originalName = path.basename(binary);
    const cleanName = extractName({ name: originalName }) || originalName;
    cleanedBinaries.push(cleanName);
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

  return { destinations, cleanedBinaries };
};

const installDeb = (debPath) => {
  safeExecSync("sudo", ["dpkg", "-i", debPath]);
  return ["System-wide deb installation"];
};

module.exports = {
  getPlatformInfo,
  selectBestAsset,
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
