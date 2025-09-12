const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { loadConfig, addInstallation, hashFile, removeInstallation } = require("./config");
const { parseSource, getGitHubAssets, downloadFromUrl } = require("./sources");
const { createLogger, confirm, fileSize } = require("./utils");

const checkForUpdates = async (packageName = null) => {
  const config = loadConfig();
  const log = createLogger();

  if (packageName) {
    const installation = config.find((item) => item.name === packageName);
    if (!installation) {
      throw new Error(
        `Package '${packageName}' not found in installation history`
      );
    }
    return await checkSingleUpdate(installation, log, true); // Force check for specific package
  }

  // Check all packages
  const updates = [];
  for (const installation of config) {
    // Skip smart_url types during bulk updates
    if (installation.source.type === 'smart_url') {
      log.debug(`Skipping smart_url package ${installation.name} during bulk update`);
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
  }

  return updates;
};

const checkSingleUpdate = async (installation, log, forceCheck = false) => {
  const { source, selected, name } = installation;

  log.debug(`Checking for updates: ${name}`);

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

    // Check if there's a newer tag (more reliable than commit for releases)
    const hasUpdate = tag !== installation.version;

    if (!hasUpdate) {
      return { name, hasUpdate: false, reason: "Already up to date" };
    }

    // Find the equivalent asset in the new release
    const newAsset = assets.find(
      (asset) =>
        asset.name.includes(selected.name.split(".")[0]) ||
        asset.extension === selected.extension ||
        asset.name.includes(name) // Also check if asset name contains the package name
    );

    if (!newAsset) {
      return {
        name,
        hasUpdate: true,
        reason: "Update available but no compatible asset found",
        canUpdate: false,
      };
    }

    return {
      name,
      hasUpdate: true,
      reason: `New version available: ${tag}`,
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
    // For URL sources, we can't easily detect updates without downloading
    // We could check Last-Modified headers or ETags, but for simplicity
    // we'll assume URLs might have updates and let user decide
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

  // For file sources, check if file still exists and has different hash
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
    // Skip smart_url during bulk updates
    return {
      name,
      hasUpdate: false,
      reason: "Smart URL type - skipped during bulk updates",
      canUpdate: false,
    };
  }

  // For specific package updates, force update smart_url types
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

  // Ensure we have source info; if missing, fetch from installation history
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

  // Re-run installation with original arguments
  const originalArgs = customFilePath ? [customFilePath] : source.originalArgs;

  // Use the installer module to avoid circular dependencies
  const { performInstallation } = require("./installer");

  try {
    await performInstallation(originalArgs, true, yesFlag); // isUpdate = true

    // After successful update, refresh the installation record with new version info
    if (updateInfo.newTag) {
      const config = loadConfig();
      const installation = config.find((item) => item.name === name);
      if (installation) {
        installation.version = updateInfo.newTag;
        installation.commit = updateInfo.newCommit;
        installation.date = new Date().toISOString();

        // Update the selected asset info if we have it
        if (updateInfo.newAsset) {
          installation.selected.name = updateInfo.newAsset.name;
          installation.selected.size = updateInfo.newAsset.size;
          installation.selected.downloadUrl = updateInfo.newAsset.browser_download_url;
        }

        const { saveConfig } = require("./config");
        saveConfig(config);
        log.debug(`Updated installation record for ${name} to version ${updateInfo.newTag}`);
      }
    }

    log.log(`Successfully updated ${name}`);
  } catch (error) {
    log.error(`Failed to update ${name}: ${error.message}`);
    throw error;
  }
};

const listInstalled = () => {
  const config = loadConfig();
  const log = createLogger();

  if (config.length === 0) {
    log.log("No packages installed via justinstall");
    return;
  }

  log.log("Installed packages:");
  for (const installation of config) {
    const { name, date, source, version } = installation;
    const installDate = new Date(date).toLocaleDateString();
    const sourceInfo =
      source.type === "github" ? `${source.owner}/${source.repo}` : source.url;
    const versionInfo = version ? ` (${version})` : "";

    log.log(
      `  ${name}${versionInfo} - ${sourceInfo} (installed ${installDate})`
    );
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
    throw new Error(`Package '${packageName}' not found in installation history`);
  }

  const destinations = installation.installation?.destinations || [];
  if (destinations.length === 0) {
    throw new Error(`No recorded destinations for '${packageName}'`);
  }

  let totalBytes = 0;
  for (const dest of destinations) {
    if (fs.existsSync(dest)) {
      try {
        totalBytes += getPathSize(dest);
      } catch (e) {
        // Ignore size calc errors; proceed with uninstall
      }
    }
  }

  const { fileSize, confirm } = require("./utils");
  const pretty = fileSize(totalBytes, true, 1);
  log.log(`Uninstalling ${packageName} (${pretty})`);
  if (!(await confirm(`Proceed to uninstall ${packageName}?`, "y", yesFlag))) {
    throw new Error("Uninstall canceled by user");
  }

  for (const dest of destinations) {
    if (fs.existsSync(dest)) {
      try {
        fs.rmSync(dest, { recursive: true, force: true });
        log.debug(`Removed ${dest}`);
      } catch (e) {
        log.warn(`Failed to remove ${dest}: ${e.message}`);
      }
    }
  }

  removeInstallation(packageName);
  log.log(`Successfully uninstalled ${packageName}`);
};

module.exports = {
  checkForUpdates,
  performUpdate,
  listInstalled,
  removePackageHistory,
  performUninstall,
};
