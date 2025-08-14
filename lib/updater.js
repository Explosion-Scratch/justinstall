const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { loadConfig, addInstallation, hashFile } = require("./config");
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
    return await checkSingleUpdate(installation, log);
  }

  // Check all packages
  const updates = [];
  for (const installation of config) {
    try {
      const updateInfo = await checkSingleUpdate(installation, log);
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

const checkSingleUpdate = async (installation, log) => {
  const { source, selected, name } = installation;

  log.debug(`Checking for updates: ${name}`);

  switch (source.type) {
    case "github":
      return await checkGitHubUpdate(installation);
    case "url":
      return await checkUrlUpdate(installation);
    case "file":
      return await checkFileUpdate(installation);
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

    // Check if there's a newer commit/tag
    const hasUpdate = commit !== oldCommit;

    if (!hasUpdate) {
      return { name, hasUpdate: false, reason: "Already up to date" };
    }

    // Find the equivalent asset in the new release
    const newAsset = assets.find(
      (asset) =>
        asset.name.includes(selected.name.split(".")[0]) ||
        asset.extension === selected.extension
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

const performUpdate = async (updateInfo, customFilePath = null) => {
  const log = createLogger();
  const { name, source } = updateInfo;

  log.log(`Updating ${name}...`);

  // Re-run installation with original arguments
  const originalArgs = customFilePath ? [customFilePath] : source.originalArgs;

  // Use the installer module to avoid circular dependencies
  const { performInstallation } = require("./installer");

  try {
    await performInstallation(originalArgs, true); // isUpdate = true
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

module.exports = {
  checkForUpdates,
  performUpdate,
  listInstalled,
  removePackageHistory,
};
