const fs = require("fs");
const path = require("path");
const os = require("os");
const { safeExecSync, createLogger, colors, confirm } = require("./utils");

const checkSudoAccess = async (silent = false) => {
  const log = silent ? { log: () => {}, warn: () => {}, error: () => {} } : createLogger();

  try {
    safeExecSync("sudo", ["-n", "true"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

const requestSudoAccess = async (reason = "installation") => {
  const log = createLogger();

  const hasSudo = await checkSudoAccess(true);
  if (hasSudo) return true;

  log.log(`${colors.fg.yellow}Administrator access required for ${reason}${colors.reset}`);
  log.log(`${colors.dim}Please enter your password when prompted${colors.reset}`);

  try {
    safeExecSync("sudo", ["-v"], { stdio: "inherit" });
    return true;
  } catch {
    log.error("Failed to acquire sudo access");
    return false;
  }
};

const keepSudoAlive = () => {
  const interval = setInterval(() => {
    try {
      safeExecSync("sudo", ["-n", "-v"], { stdio: "pipe" });
    } catch {
      clearInterval(interval);
    }
  }, 60000);

  return () => clearInterval(interval);
};

const runWithSudo = (command, args = [], options = {}) => {
  const { progressCallback, requiresSudo = true } = options;

  if (!requiresSudo) {
    return safeExecSync(command, args, { ...options, stdio: "pipe" });
  }

  return safeExecSync("sudo", [command, ...args], { ...options, stdio: options.stdio || "pipe" });
};

const getPkgReceipts = () => {
  const receiptsDir = "/var/db/receipts";
  if (!fs.existsSync(receiptsDir)) return [];

  try {
    return fs
      .readdirSync(receiptsDir)
      .filter((f) => f.endsWith(".plist"))
      .map((f) => {
        const name = f.replace(".plist", "");
        return {
          id: name,
          plistPath: path.join(receiptsDir, f),
          bomPath: path.join(receiptsDir, `${name}.bom`),
        };
      });
  } catch {
    return [];
  }
};

const findPackageReceipt = (name) => {
  const receipts = getPkgReceipts();
  const nameLower = name.toLowerCase();

  return receipts.find((r) => {
    const idLower = r.id.toLowerCase();
    return (
      idLower.includes(nameLower) ||
      nameLower.includes(idLower.split(".").pop())
    );
  });
};

const getFilesFromBom = (bomPath) => {
  if (!fs.existsSync(bomPath)) return [];

  try {
    const output = safeExecSync("lsbom", ["-pf", bomPath], { encoding: "utf8" });
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("."));
  } catch {
    return [];
  }
};

const getPackageInstallLocation = (receiptId) => {
  try {
    const output = safeExecSync(
      "pkgutil",
      ["--pkg-info", receiptId],
      { encoding: "utf8" }
    );

    const locationMatch = output.match(/location:\s*(.+)/);
    const volumeMatch = output.match(/volume:\s*(.+)/);

    const volume = volumeMatch ? volumeMatch[1].trim() : "/";
    const location = locationMatch ? locationMatch[1].trim() : "";

    if (volume === "/" && !location.startsWith("/")) {
      return "/" + location;
    }

    return path.join(volume, location);
  } catch {
    return "/";
  }
};

const forgetPackage = async (receiptId) => {
  const log = createLogger();

  try {
    await requestSudoAccess("package removal");
    safeExecSync("sudo", ["pkgutil", "--forget", receiptId], { stdio: "pipe" });
    log.log(`Removed package receipt: ${receiptId}`);
    return true;
  } catch (e) {
    log.warn(`Failed to forget package receipt: ${e.message}`);
    return false;
  }
};

const getAppBundleId = (appPath) => {
  const plistPath = path.join(appPath, "Contents", "Info.plist");

  if (!fs.existsSync(plistPath)) return null;

  try {
    const output = safeExecSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleIdentifier", plistPath],
      { encoding: "utf8" }
    );
    return output.trim();
  } catch {
    return null;
  }
};

const getAppSupportDirs = (bundleId, appName) => {
  const home = os.homedir();
  const dirs = [];

  const possibleDirs = [
    path.join(home, "Library", "Application Support", appName),
    path.join(home, "Library", "Caches", bundleId),
    path.join(home, "Library", "Caches", appName),
    path.join(home, "Library", "Preferences", `${bundleId}.plist`),
    path.join(home, "Library", "Saved Application State", `${bundleId}.savedState`),
    path.join(home, "Library", "Logs", appName),
    path.join(home, "Library", "Containers", bundleId),
    path.join(home, "Library", "Group Containers"),
  ];

  possibleDirs.forEach((dir) => {
    if (fs.existsSync(dir)) {
      dirs.push(dir);
    }
  });

  if (bundleId) {
    const groupContainers = path.join(home, "Library", "Group Containers");
    if (fs.existsSync(groupContainers)) {
      try {
        const entries = fs.readdirSync(groupContainers);
        entries.forEach((entry) => {
          if (entry.includes(bundleId) || entry.includes(appName)) {
            dirs.push(path.join(groupContainers, entry));
          }
        });
      } catch {}
    }
  }

  return dirs;
};

const findLaunchAgents = (bundleId, appName) => {
  const home = os.homedir();
  const agents = [];
  const dirs = [
    path.join(home, "Library", "LaunchAgents"),
    "/Library/LaunchAgents",
    "/Library/LaunchDaemons",
  ];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;

    try {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const fileLower = file.toLowerCase();
        const bundleIdLower = (bundleId || "").toLowerCase();
        const appNameLower = appName.toLowerCase();

        if (fileLower.includes(bundleIdLower) || fileLower.includes(appNameLower)) {
          agents.push(path.join(dir, file));
        }
      });
    } catch {}
  });

  return agents;
};

const unloadLaunchAgent = (plistPath) => {
  try {
    safeExecSync("launchctl", ["unload", plistPath], { stdio: "pipe" });
    return true;
  } catch {
    try {
      runWithSudo("launchctl", ["unload", plistPath], { requiresSudo: true });
      return true;
    } catch {
      return false;
    }
  }
};

const completeAppUninstall = async (appPath, log, yesFlag = false) => {
  const appName = path.basename(appPath, ".app");
  const bundleId = getAppBundleId(appPath);
  const removedPaths = [appPath];

  log.log(`Performing complete uninstall of ${appName}`);

  if (bundleId) {
    log.log(`  Bundle ID: ${bundleId}`);
  }

  const supportDirs = getAppSupportDirs(bundleId, appName);
  if (supportDirs.length > 0) {
    log.log(`  Found ${supportDirs.length} support directories`);
  }

  const launchAgents = findLaunchAgents(bundleId, appName);
  for (const agent of launchAgents) {
    log.log(`  Unloading launch agent: ${path.basename(agent)}`);
    unloadLaunchAgent(agent);
  }

  for (const agent of launchAgents) {
    try {
      if (agent.startsWith("/Library")) {
        await requestSudoAccess("removing system launch agent");
        runWithSudo("rm", ["-rf", agent], { requiresSudo: true });
      } else {
        fs.rmSync(agent, { recursive: true, force: true });
      }
      removedPaths.push(agent);
      log.log(`  Removed: ${agent}`);
    } catch (e) {
      log.warn(`  Failed to remove ${agent}: ${e.message}`);
    }
  }

  for (const dir of supportDirs) {
    if (await confirm(`Remove support directory: ${dir}?`, "y", yesFlag)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        removedPaths.push(dir);
        log.log(`  Removed: ${dir}`);
      } catch (e) {
        log.warn(`  Failed to remove ${dir}: ${e.message}`);
      }
    } else {
      log.log(`  Skipped: ${dir}`);
    }
  }

  if (fs.existsSync(appPath)) {
    try {
      fs.rmSync(appPath, { recursive: true, force: true });
      log.log(`  Removed: ${appPath}`);
    } catch (e) {
      try {
        await requestSudoAccess("app removal");
        runWithSudo("rm", ["-rf", appPath], { requiresSudo: true });
        log.log(`  Removed: ${appPath}`);
      } catch (sudoError) {
        log.warn(`  Failed to remove app: ${sudoError.message}`);
      }
    }
  }

  if (bundleId) {
    const matchingReceipt = findPackageReceipt(appName);
    if (matchingReceipt) {
      await forgetPackage(matchingReceipt.id);
    }
  }

  return removedPaths;
};

const completePkgUninstall = async (packageName, log) => {
  const receipt = findPackageReceipt(packageName);
  const removedPaths = [];

  if (!receipt) {
    log.warn(`No package receipt found for ${packageName}`);
    return removedPaths;
  }

  log.log(`Found package receipt: ${receipt.id}`);

  const installLocation = getPackageInstallLocation(receipt.id);
  log.log(`Install location: ${installLocation}`);

  if (fs.existsSync(receipt.bomPath)) {
    const files = getFilesFromBom(receipt.bomPath);
    log.log(`Found ${files.length} files in package`);

    await requestSudoAccess("package file removal");

    const sortedFiles = files.sort((a, b) => b.length - a.length);

    for (const file of sortedFiles) {
      const fullPath = path.join(installLocation, file);
      if (fs.existsSync(fullPath)) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const contents = fs.readdirSync(fullPath);
            if (contents.length === 0) {
              runWithSudo("rmdir", [fullPath], { requiresSudo: true });
              removedPaths.push(fullPath);
            }
          } else {
            runWithSudo("rm", ["-f", fullPath], { requiresSudo: true });
            removedPaths.push(fullPath);
          }
        } catch (e) {
          log.warn(`  Failed to remove ${fullPath}: ${e.message}`);
        }
      }
    }
  }

  await forgetPackage(receipt.id);
  removedPaths.push(receipt.plistPath);
  if (fs.existsSync(receipt.bomPath)) {
    removedPaths.push(receipt.bomPath);
  }

  return removedPaths;
};

const detectOrphanedInstallations = (installations) => {
  const orphaned = [];

  for (const installation of installations) {
    const destinations = installation.installation?.destinations || [];
    let isOrphaned = true;

    for (const dest of destinations) {
      if (dest === "System-wide package installation" || dest === "System-wide deb installation") {
        const receipt = findPackageReceipt(installation.name);
        if (receipt) {
          isOrphaned = false;
          break;
        }
      } else if (fs.existsSync(dest)) {
        isOrphaned = false;
        break;
      }
    }

    if (isOrphaned && destinations.length > 0) {
      orphaned.push({
        ...installation,
        reason: "No installed files found",
      });
    }
  }

  return orphaned;
};

module.exports = {
  checkSudoAccess,
  requestSudoAccess,
  keepSudoAlive,
  runWithSudo,
  getPkgReceipts,
  findPackageReceipt,
  getFilesFromBom,
  getPackageInstallLocation,
  forgetPackage,
  getAppBundleId,
  getAppSupportDirs,
  findLaunchAgents,
  unloadLaunchAgent,
  completeAppUninstall,
  completePkgUninstall,
  detectOrphanedInstallations,
};
