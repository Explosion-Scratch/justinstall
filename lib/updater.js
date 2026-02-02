
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { loadConfig, addInstallation, hashFile, removeInstallation } = require("./config");
const { parseSource, getGitHubAssets, downloadFromUrl } = require("./sources");
const { createLogger, confirm, fileSize, colors } = require("./utils");
const {
  requestSudoAccess,
  completeAppUninstall,
  completePkgUninstall,
} = require("./system");
const { createModuleProgress, createSpinner } = require("./progress");

const checkForUpdates = async (packageName = null) => {
  const config = loadConfig();
  const log = createLogger();

  if (packageName) {
    const installation = config.find((item) => item.name === packageName);
    if (!installation) {
      throw new Error(
        `Package '${packageName}' not found in installation history.\n` +
        `Run '${colors.fg.cyan}justinstall --list${colors.reset}' to see installed packages.`
      );
    }
    return await checkSingleUpdate(installation, log, true);
  }

  const updates = [];
  const spinner = createSpinner("Checking packages for updates...");
  spinner.start();

  let checkedCount = 0;
  const total = config.length;

  for (const installation of config) {
    if (installation.source.type === 'smart_url') {
      log.log(`${colors.dim}Skipping smart_url package ${installation.name}${colors.reset}`);
      continue;
    }

    try {
      const updateInfo = await checkSingleUpdate(installation, log, false);
      if (updateInfo.hasUpdate) {
        updates.push(updateInfo);
      }
    } catch (error) {
      log.warn(
        `Failed to check updates for ${installation.name}: ${error.message}`
      );
    }

    checkedCount++;
  }

  spinner.stop(`Checked ${total} package(s)`);

  return updates;
};

const checkSingleUpdate = async (installation, log, forceCheck = false) => {
  const { source, selected, name } = installation;

  switch (source.type) {
    case "github":
      return await checkGitHubUpdate(installation);
    case "url":
      return await checkUrlUpdate(installation);
    case "file":
      return await checkFileUpdate(installation);
    case "smart_url":
      return await checkSmartUrlUpdate(installation, forceCheck);
    default:
      throw new Error(`Unknown source type: ${source.type}`);
  }
};

const checkGitHubUpdate = async (installation) => {
  const { source, selected, commit: oldCommit, name } = installation;

  try {
    const { assets, tag, commit } = await getGitHubAssets(
      source.owner,
      source.repo
    );

    const hasUpdate = tag !== installation.version;

    if (!hasUpdate) {
      return { name, hasUpdate: false, reason: "Already up to date" };
    }

    const newAsset = assets.find(
      (asset) =>
        asset.name.includes(selected.name.split(".")[0]) ||
        asset.extension === selected.extension ||
        asset.name.includes(name)
    );

    if (!newAsset) {
      const preferredMethod = installation.installation?.preferredMethod;
      if (preferredMethod === "script") {
        return {
          name,
          hasUpdate: true,
          reason: `${installation.version || "unknown"} → ${tag}`,
          canUpdate: true,
          currentCommit: oldCommit,
          newCommit: commit,
          newTag: tag,
          source,
        };
      }

      return {
        name,
        hasUpdate: true,
        reason: `${installation.version} → ${tag} (no compatible asset found)`,
        canUpdate: false,
      };
    }

    return {
      name,
      hasUpdate: true,
      reason: `${installation.version || "unknown"} → ${tag}`,
      canUpdate: true,
      currentCommit: oldCommit,
      newCommit: commit,
      newTag: tag,
      newAsset,
      source,
    };
  } catch (error) {
    return {
      name,
      hasUpdate: false,
      reason: `Failed to check GitHub: ${error.message}`,
      error: true,
    };
  }
};

const checkUrlUpdate = async (installation) => {
  const { source, selected, name } = installation;

  try {
    return {
      name,
      hasUpdate: true,
      reason: "URL source - check manually for updates",
      canUpdate: true,
      source,
    };
  } catch (error) {
    return {
      name,
      hasUpdate: false,
      reason: `Failed to check URL: ${error.message}`,
      error: true,
    };
  }
};

const checkFileUpdate = async (installation) => {
  const { source, selected, name } = installation;

  if (!fs.existsSync(source.url)) {
    return {
      name,
      hasUpdate: false,
      reason: "Original file no longer exists",
      error: true,
    };
  }

  const currentHash = hashFile(source.url);
  const hasUpdate = currentHash !== selected.hash;

  return {
    name,
    hasUpdate,
    reason: hasUpdate ? "File has been modified" : "File unchanged",
    canUpdate: hasUpdate,
    source,
    newHash: currentHash,
  };
};

const checkSmartUrlUpdate = async (installation, forceCheck) => {
  const { source, selected, name } = installation;

  if (!forceCheck) {
    return {
      name,
      hasUpdate: false,
      reason: "Smart URL type - skipped during bulk updates",
      canUpdate: false,
    };
  }

  return {
    name,
    hasUpdate: true,
    reason: "Smart URL source - forced update",
    canUpdate: true,
    source,
  };
};

const performUpdate = async (updateInfo, customFilePath = null, yesFlag = false) => {
  const log = createLogger();
  const { name } = updateInfo;

  let source = updateInfo.source;
  if (!source) {
    const config = loadConfig();
    const installation = config.find((item) => item.name === name);
    if (!installation) {
      throw new Error(`No installation record found for '${name}'`);
    }
    source = installation.source;
  }

  log.log(`Updating ${name}...`);

  const rawOriginalArgs = customFilePath ? [customFilePath] : source.originalArgs;
  const originalArgs = Array.isArray(rawOriginalArgs) ? rawOriginalArgs : [rawOriginalArgs];

  const { performInstallation } = require("./installer");

  try {
    await performInstallation(originalArgs, true, yesFlag);

    if (updateInfo.newTag) {
      const config = loadConfig();
      const installation = config.find((item) => item.name === name);
      if (installation) {
        installation.version = updateInfo.newTag;
        installation.commit = updateInfo.newCommit;
        installation.date = new Date().toISOString();

        if (updateInfo.newAsset) {
          installation.selected.name = updateInfo.newAsset.name;
          installation.selected.size = updateInfo.newAsset.size;
          installation.selected.downloadUrl = updateInfo.newAsset.browser_download_url;
        }

        const { saveConfig } = require("./config");
        saveConfig(config);
      }
    }

    log.log(`${colors.fg.green}✓${colors.reset} Successfully updated ${name}`);
  } catch (error) {
    log.error(`Failed to update ${name}: ${error.message}`);
    throw error;
  }
};

const listInstalled = () => {
  const config = loadConfig();
  const log = createLogger();

  if (config.length === 0) {
    log.log(`${colors.fg.yellow}No packages installed via justinstall${colors.reset}`);
    log.log(`\nTo install a package, run: ${colors.fg.cyan}justinstall <github-repo>${colors.reset}`);
    log.log(`Example: ${colors.fg.cyan}justinstall junegunn/fzf${colors.reset}`);
    return;
  }

  log.log(`${colors.fg.cyan}Installed packages (${config.length}):${colors.reset}\n`);

  for (const installation of config) {
    const { name, date, source, version, installation: installInfo } = installation;
    const installDate = new Date(date).toLocaleDateString();
    const sourceInfo =
      source.type === "github" ? `${source.owner}/${source.repo}` : source.url;
    const versionInfo = version ? `${colors.fg.green}${version}${colors.reset}` : `${colors.dim}unknown${colors.reset}`;
    const methodInfo = installInfo?.method || "unknown";

    log.log(`  ${colors.fg.white}${name}${colors.reset}`);
    log.log(`    Version: ${versionInfo}`);
    log.log(`    Source: ${colors.dim}${sourceInfo}${colors.reset}`);
    log.log(`    Method: ${colors.dim}${methodInfo}${colors.reset}`);
    log.log(`    Installed: ${colors.dim}${installDate}${colors.reset}`);
    log.log("");
  }
};

const removePackageHistory = (packageName) => {
  const { removeInstallation } = require("./config");
  removeInstallation(packageName);
};

const getPathSize = (p) => {
  const stat = fs.statSync(p);
  if (stat.isFile()) return stat.size;
  if (stat.isDirectory()) {
    let total = 0;
    for (const entry of fs.readdirSync(p)) {
      total += getPathSize(path.join(p, entry));
    }
    return total;
  }
  return 0;
};

const performUninstall = async (packageName, yesFlag = false) => {
  const log = createLogger();
  const config = loadConfig();
  const installation = config.find((item) => item.name === packageName);

  if (!installation) {
    throw new Error(
      `Package '${packageName}' not found in installation history.\n` +
      `Run '${colors.fg.cyan}justinstall --list${colors.reset}' to see installed packages.`
    );
  }

  const destinations = installation.installation?.destinations || [];
  const method = installation.installation?.method || "unknown";

  if (destinations.length === 0) {
    log.warn(`No recorded destinations for '${packageName}', removing from history only`);
    removeInstallation(packageName);
    log.log(`Removed ${packageName} from installation history`);
    return;
  }

  let totalBytes = 0;
  for (const dest of destinations) {
    if (fs.existsSync(dest)) {
      try {
        totalBytes += getPathSize(dest);
      } catch (e) {}
    }
  }

  const pretty = fileSize(totalBytes, true, 1);
  log.log(`\n${colors.fg.cyan}Uninstalling ${packageName}${colors.reset}`);
  log.log(`  Method: ${method}`);
  log.log(`  Size: ${pretty}`);
  log.log(`  Locations: ${destinations.length} file(s)/folder(s)`);

  if (!(await confirm(`\nProceed to uninstall ${packageName}?`, "y", yesFlag))) {
    throw new Error("Uninstall canceled by user");
  }

  const progress = createModuleProgress();

  if (method === "app" || method === "dmg" || method === "archive_app" || method === "dmg_app") {
    const appPath = destinations.find((d) => d.endsWith(".app"));
    if (appPath && fs.existsSync(appPath)) {
      progress.startModule("Removing app and related files");
      await completeAppUninstall(appPath, log, yesFlag);
      progress.completeModule(true);
    }
  } else if (method === "pkg" || method === "dmg_pkg") {
    progress.startModule("Removing package and receipts");
    await completePkgUninstall(packageName, log);
    progress.completeModule(true);
  } else {
    progress.startModule("Removing files");
    for (const dest of destinations) {
      if (fs.existsSync(dest)) {
        try {
          fs.rmSync(dest, { recursive: true, force: true });
          log.log(`  Removed ${dest}`);
        } catch (e) {
          try {
            await requestSudoAccess("file removal");
            require("./system").runWithSudo("rm", ["-rf", dest], { requiresSudo: true });
            log.log(`  Removed ${dest}`);
          } catch (sudoError) {
            log.warn(`  Failed to remove ${dest}: ${sudoError.message}`);
          }
        }
      }
    }
    progress.completeModule(true);
  }

  removeInstallation(packageName);
  log.log(`\n${colors.fg.green}✓${colors.reset} Successfully uninstalled ${packageName}`);
};

module.exports = {
  checkForUpdates,
  performUpdate,
  listInstalled,
  removePackageHistory,
  performUninstall,
};
