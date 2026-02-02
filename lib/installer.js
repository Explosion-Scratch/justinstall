const fs = require("fs");
const path = require("path");
const { safeExecSync } = require("./utils");
const os = require("os");

const {
  parseSource,
  getGitHubAssets,
  getWebsiteAssets,
  trySmartDownload,
  downloadFromUrl,
  findInstallScripts,
  hasHighPriorityInstallScript,
  getHighestScriptScore,
} = require("./sources");
const {
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
} = require("./installers");
const {
  getInstallCapabilities,
  extractArchive,
  getExtension,
  isInstallerScriptExtension,
} = require("./extensions");
const {
  isInstallerScriptCompatible,
  executeInstallerScript,
  previewInstallerScript,
  getInstallerScriptConfig,
} = require("./installer-scripts");
const {
  createInstallationRecord,
  addInstallation,
  hashFile,
  extractName,
  getInstallation,
} = require("./config");
const {
  createLogger,
  confirm,
  fileSize,
  checkPath,
  processInstallSnippetReplacements,
  promptChoice,
  promptChoiceWithEdit,
  editScriptInEditor,
  colors,
} = require("./utils");

const SCRIPT_PREVIEW_CONFIG = {
  MAX_LENGTH: 100,
  ELLIPSIS_LENGTH: 3,
  get truncateLength() {
    return this.MAX_LENGTH - this.ELLIPSIS_LENGTH;
  },
};

let tmpdir;

const performInstallation = async (args, isUpdate = false, yesFlag = false) => {
  const log = createLogger();

  if (args.length === 0) {
    throw new Error("No installation source provided");
  }

  const source = parseSource(args[0]);
  const customFilePath = args[1]; // For update with custom file path

  tmpdir = safeExecSync("mktemp -d", [], { encoding: "utf8" }).trim();

  const platformInfo = getPlatformInfo();
  const capabilities = getInstallCapabilities();

  log.debug(`Detected ${platformInfo.arch} on ${platformInfo.platform}`);

  let selected;
  let releaseInfo = {};
  let downloadPath;

  try {
    switch (source.type) {
      case "file":
        selected = await handleFileSource(source, customFilePath, log);
        break;
      case "url":
        selected = await handleUrlSource(source, log);
        break;
      case "smart_url":
        const smartResult = await handleSmartUrlSource(
          source,
          platformInfo,
          capabilities,
          log,
        );
        selected = smartResult.selected;
        releaseInfo = smartResult.releaseInfo;
        break;
      case "website":
        const websiteResult = await handleWebsiteSource(
          source,
          platformInfo,
          capabilities,
          log,
        );
        selected = websiteResult.selected;
        releaseInfo = websiteResult.releaseInfo;
        break;
      case "github":
        const result = await handleGitHubSource(
          source,
          platformInfo,
          capabilities,
          log,
          yesFlag,
          isUpdate,
        );

        // Handle script installation case
        if (result && result.method === "script") {
          log.log(`Successfully installed via script: ${source.repo}`);
          return;
        }

        selected = result.selected;
        releaseInfo = result.releaseInfo;
        break;
    }

    if (!selected) {
      throw new Error("No suitable package found");
    }

    const shouldInstall = await confirm(
      `Ok to ${isUpdate ? "update" : "install"} ${selected.name} (${selected.size ? fileSize(selected.size) : selected.browser_download_url})?`,
      "y",
      yesFlag
    );

    if (!shouldInstall) {
      throw new Error(`Aborted ${isUpdate ? "update" : "installation"}`);
    }

    downloadPath = await downloadSelected(selected, source, log);
    const installationResult = await installSelected(
      selected,
      downloadPath,
      log,
      yesFlag,
      isUpdate,
    );

    if (!isUpdate) {
      // Save installation record
      const fileHash = hashFile(downloadPath);
      const installRecord = createInstallationRecord(source, selected, {
        name: extractName(selected),
        hash: fileHash,
        installMethod: installationResult.method,
        preferredMethod: installationResult.method,
        selectedAssetPattern: selected.name,
        binaries: installationResult.binaries,
        destinations: installationResult.destinations,
        version: releaseInfo.tag,
        commit: releaseInfo.commit,
        prerelease: releaseInfo.prerelease,
      });

      addInstallation(installRecord);
    }

    log.log(
      `Successfully ${isUpdate ? "updated" : "installed"
      }: ${installationResult.binaries.join(", ")}`,
    );
  } finally {
    cleanup();
  }
};

const handleFileSource = async (source, customFilePath, log) => {
  const filePath = customFilePath || source.url;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  log.debug(`Installing from local file: ${filePath}`);

  const stats = fs.statSync(filePath);
  const basename = path.basename(filePath);
  return {
    name: extractName({ name: basename }),
    size: stats.size,
    extension: getExtension(basename),
    localPath: filePath,
  };
};

const handleUrlSource = async (source, log) => {
  log.debug("Downloading file from URL...");

  const tempFilename = path.join(tmpdir, "download");
  const { filename, size } = await downloadFromUrl(
    source.url,
    tempFilename,
    log,
  );

  log.debug(`Downloaded ${filename} to ${path.resolve(tempFilename)}`);

  return {
    name: filename,
    size: size,
    extension: getExtension(filename),
    browser_download_url: source.url,
    localPath: tempFilename,
  };
};

const handleSmartUrlSource = async (
  source,
  platformInfo,
  capabilities,
  log,
) => {
  log.debug(`Attempting smart download from: ${source.url}`);

  const result = await trySmartDownload(source.url, log);

  if (result.type === "direct_download") {
    // It was a direct download
    log.debug(`Direct download: ${result.filename} (${result.size} bytes)`);

    const extension = getExtension(result.filename);

    return {
      selected: {
        name: result.filename,
        size: result.size,
        extension: extension,
        browser_download_url: result.url,
        localPath: result.localPath,
      },
      releaseInfo: { body: `Direct download of ${result.filename}` },
    };
  } else if (result.type === "scraped_assets") {
    // It was HTML, so we scraped it for assets
    log.debug(`Found ${result.assets.length} potential assets from HTML`);

    if (result.assets.length > 0) {
      log.debug("Assets found:");
      result.assets.forEach((asset, index) => {
        log.debug(
          `  ${index + 1}. ${asset.name} (ext: ${asset.extension || "none"
          }, url: ${asset.browser_download_url})`,
        );
      });
    }

    // Try to find a suitable asset using the same logic as GitHub
    const selected = selectBestAsset(result.assets, platformInfo, capabilities);

    if (!selected) {
      // List available assets to help user
      log.log("No compatible assets found. Available downloads:");
      result.assets.forEach((asset, index) => {
        log.log(
          `  ${index + 1}. ${asset.name} (${asset.extension || "no extension"
          }) - ${asset.browser_download_url}`,
        );
      });

      throw new Error(
        `Couldn't find a compatible download for ${platformInfo.platform}/${platformInfo.arch}. ` +
        `Check manually: ${source.url}`,
      );
    }

    log.debug(`Selected asset: ${selected.name} (${selected.extension})`);

    return {
      selected,
      releaseInfo: { body: result.body },
    };
  }

  throw new Error("Unexpected result from smart download");
};

const handleWebsiteSource = async (source, platformInfo, capabilities, log) => {
  log.debug(`Scraping website for downloadable assets: ${source.url}`);

  const { assets, body } = await getWebsiteAssets(source.url);

  log.debug(`Found ${assets.length} potential assets`);

  if (assets.length > 0) {
    log.debug("Assets found:");
    assets.forEach((asset, index) => {
      log.debug(
        `  ${index + 1}. ${asset.name} (ext: ${asset.extension || "none"
        }, url: ${asset.browser_download_url})`,
      );
    });
  }

  // Try to find a suitable asset using the same logic as GitHub
  const selected = selectBestAsset(assets, platformInfo, capabilities);

  if (!selected) {
    // List available assets to help user
    log.log("No compatible assets found. Available downloads:");
    assets.forEach((asset, index) => {
      log.log(
        `  ${index + 1}. ${asset.name} (${asset.extension || "no extension"
        }) - ${asset.browser_download_url}`,
      );
    });

    throw new Error(
      `Couldn't find a compatible download for ${platformInfo.platform}/${platformInfo.arch}. ` +
      `Check manually: ${source.url}`,
    );
  }

  log.debug(`Selected asset: ${selected.name} (${selected.extension})`);

  return {
    selected,
    releaseInfo: { body },
  };
};

const displayScriptPreview = (script, log) => {
  const { code, source, score } = script;
  log.log(
    `Found installer code in ${source} (score: ${score}):\n\n` +
    colors.fg.green +
    code +
    colors.reset +
    "\n",
  );
};

const truncatePreview = (
  text,
  maxLength = SCRIPT_PREVIEW_CONFIG.MAX_LENGTH,
) => {
  if (text.length <= maxLength) return text;
  return text.substring(0, SCRIPT_PREVIEW_CONFIG.truncateLength) + "...";
};

const displayScriptList = (installScripts, log) => {
  log.log(`Found ${installScripts.length} install scripts:`);

  installScripts.forEach((script, index) => {
    const firstLine = script.code.split("\n")[0]?.trim() || "";
    const preview = truncatePreview(firstLine);
    log.log(
      `  ${index + 1}. [Score: ${script.score}] ${script.source}: ${preview}`,
    );
  });

  const continueOption = installScripts.length + 1;
  const exitOption = installScripts.length + 2;

  log.log(`  ${continueOption}. Continue to regular installation`);
  log.log(`  ${exitOption}. Exit installation`);
};

const handleSingleScript = async (script, log, yesFlag = false) => {
  displayScriptPreview(script, log);

  while (true) {
    const readline = require('readline');
    const rli = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const choice = await new Promise((resolve) => {
      rli.question(`${colors.fg.yellow}Run install script (y/n) or edit (e)?${colors.reset} `, (ans) => {
        rli.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    if (choice === 'e') {
      const editedScript = await editScriptInEditor(script);
      displayScriptPreview(editedScript, log);

      const shouldRun = await confirm(
        "Run this edited install script (y) or continue to regular installation (n)?",
        "y",
        yesFlag
      );

      if (shouldRun) return editedScript;
      return null;
    } else if (choice === 'y' || choice === 'yes') {
      return script;
    } else if (choice === 'n' || choice === 'no') {
      return null;
    }
  }
};

const handleMultipleScripts = async (installScripts, log, yesFlag = false) => {
  const CONTINUE_OPTION = installScripts.length + 1;
  const EXIT_OPTION = installScripts.length + 2;

  while (true) {
    displayScriptList(installScripts, log);

    const readline = require('readline');
    const rli = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const choice = await new Promise((resolve) => {
      rli.question(`${colors.fg.yellow}Select install script (1-${EXIT_OPTION}):${colors.reset} `, (ans) => {
        rli.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    const numericChoice = parseInt(choice);

    if (isNaN(numericChoice)) {
      console.log(`${colors.fg.red}Invalid choice. Please enter a number.${colors.reset}`);
      continue;
    }

    if (numericChoice === CONTINUE_OPTION) {
      return null; // Continue to regular installation
    } else if (numericChoice === EXIT_OPTION) {
      throw new Error("Installation aborted by user");
    } else if (numericChoice > 0 && numericChoice <= installScripts.length) {
      let script = installScripts[numericChoice - 1];
      displayScriptPreview(script, log);

      let actionLoop = true;
      while (actionLoop) {
        const rliAction = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const action = await new Promise((resolve) => {
          rliAction.question(`${colors.fg.yellow}Run (y), Edit (e), or Select Different (n)?${colors.reset} `, (ans) => {
            rliAction.close();
            resolve(ans.trim().toLowerCase());
          });
        });

        if (action === 'y' || action === 'yes') {
          return script;
        } else if (action === 'n' || action === 'no') {
          actionLoop = false;
        } else if (action === 'e') {
          script = await editScriptInEditor(script);
          displayScriptPreview(script, log);
        } else {
            // Optional: Handle invalid input if needed, strictly asking for y/e/n
        }
      }
    } else {
      console.log(`${colors.fg.red}Invalid choice. Please try again.${colors.reset}`);
    }
  }
};

const selectInstallScript = async (installScripts, log, yesFlag = false) => {
  if (installScripts.length === 0) return null;

  if (installScripts.length === 1) {
    return await handleSingleScript(installScripts[0], log, yesFlag);
  }

  return await handleMultipleScripts(installScripts, log, yesFlag);
};

const executeInstallScript = (script, log) => {
  log.debug("Running install script...");
  const processedCode = processInstallSnippetReplacements(script.code);
  safeExecSync("sh", ["-c", processedCode], { stdio: "inherit" });
};

const handleGitHubSource = async (source, platformInfo, capabilities, log, yesFlag = false, isUpdate = false) => {
  let assets = [];
  let body = "";
  let tag = null;
  let commit = null;
  let prerelease = false;

  const previousInstallation = getInstallation(source.repo);
  const preferredMethod = previousInstallation?.installation?.preferredMethod;
  const previousAssetPattern = previousInstallation?.installation?.selectedAssetPattern;
  const storedScript = previousInstallation?.installation?.script;

  if (isUpdate && preferredMethod) {
    log.debug(`Previous installation used method: ${preferredMethod}`);
  }

  try {
    const releaseData = await getGitHubAssets(
      source.owner,
      source.repo,
      source.specificTag,
    );
    assets = releaseData.assets;
    body = releaseData.body;
    tag = releaseData.tag;
    commit = releaseData.commit;
    prerelease = releaseData.prerelease;
  } catch (error) {
    if (!error.message.includes("No releases found in GitHub repository")) {
      throw error;
    }
    log.debug("No releases found, checking for install scripts in README");
  }

  log.debug(`Found ${assets.length} assets`);

  if (prerelease) {
    log.warn(`Using prerelease version: ${tag}`);
  } else if (tag) {
    log.debug(`Using stable release: ${tag}`);
  }

  const selected = selectBestAsset(assets, platformInfo, capabilities);
  // Boost binary score significantly if we found a compatible binary
  // This ensures we prioritize direct binary downloads over install scripts unless strict overrides exist
  const binaryScore = selected ? (selected.points || 10) + 100 : 0;

  const skipScriptDetection = isUpdate && preferredMethod && 
    !["script", "installer_script"].includes(preferredMethod);

  let installScripts = [];
  if (isUpdate && preferredMethod === "script" && storedScript) {
    log.debug("Using stored install script from previous installation");
    installScripts = [
      {
        code: storedScript,
        source: "stored script",
        score: 1000,
      },
    ];
  } else if (!skipScriptDetection) {
    installScripts = await findInstallScripts(
      source.owner,
      source.repo,
      body,
    );
    log.debug(
      `Found ${installScripts.length} platform-compatible install scripts`,
    );
  } else {
    log.debug(
      `Skipping script detection - previous install used: ${preferredMethod}`,
    );
  }

  const installerScript = assets.find((i) => i.name.includes("installer.sh"));
  if (installerScript && !skipScriptDetection) {
    log.debug(`Found installer script: ${installerScript.name}`);

    if (await confirm(`Run install script? ${installerScript.name}`, "y", yesFlag)) {
      const scriptPath = path.join(tmpdir, "installer.sh");
      const { size } = await downloadFromUrl(
        installerScript.browser_download_url,
        scriptPath,
        log,
      );
      safeExecSync("chmod", ["+x", scriptPath]);
      safeExecSync(scriptPath, [], { stdio: "inherit" });

      const installRecord = createInstallationRecord(source, installerScript, {
        name: source.repo,
        installMethod: "installer_script",
        preferredMethod: "installer_script",
        version: tag,
        commit: commit,
        prerelease: prerelease,
      });
      addInstallation(installRecord);

      return;
    }
  }

  const highestScriptScore = getHighestScriptScore(installScripts);
  const shouldPreferBinary = selected && binaryScore >= highestScriptScore;

  log.debug(`Binary score: ${binaryScore}, Highest script score: ${highestScriptScore}, Prefer binary: ${shouldPreferBinary}`);

  const shouldUseInstallSnippets =
    !skipScriptDetection &&
    !shouldPreferBinary &&
    (!selected || hasHighPriorityInstallScript(installScripts, binaryScore));

  log.debug(`Selected asset: ${!!selected}, use snippets: ${shouldUseInstallSnippets}, scripts: ${installScripts.length}`);

  if (shouldUseInstallSnippets && installScripts.length > 0) {
    if (!selected) {
      log.debug(`No suitable asset found, using install scripts as fallback`);
    } else {
      log.debug(
        `Found high priority install script, using it instead of asset`,
      );
    }
    log.debug(`Found ${installScripts.length} install script(s)`);

    const selectedScript = await selectInstallScript(installScripts, log, yesFlag);

    if (selectedScript) {
      const processedCode = processInstallSnippetReplacements(selectedScript.code);
      executeInstallScript(selectedScript, log);

      const installRecord = createInstallationRecord(
        source,
        { name: `${source.owner}/${source.repo}` },
        {
          name: source.repo,
          installMethod: "script",
          preferredMethod: "script",
          script: processedCode,
          version: tag,
          commit: commit,
          prerelease: prerelease,
        },
      );
      addInstallation(installRecord);

      return { success: true, method: "script" };
    }
  }

  if (!selected) {
    if (assets.length === 0 && installScripts.length > 0) {
      throw new Error(
        `No releases found, but install scripts are available. This shouldn't happen - check the install script logic.`,
      );
    }
    throw new Error(
      `Couldn't find a compatible binary for ${platformInfo.platform}/${platformInfo.arch}. ` +
      `Check manually: https://github.com/${source.owner}/${source.repo}/releases`,
    );
  }

  return {
    selected,
    releaseInfo: { tag, commit, body, prerelease },
  };
};

const downloadSelected = async (selected, source, log) => {
  if (selected.localPath) {
    // File or already downloaded
    log.debug(`Using local file: ${path.resolve(selected.localPath)}`);
    return selected.localPath;
  }

  const downloadPath = path.join(tmpdir, selected.name);
  log.debug(`Downloading ${selected.name} to ${path.resolve(downloadPath)}`);

  await downloadFromUrl(selected.browser_download_url, downloadPath, log);
  return downloadPath;
};

const installSelected = async (selected, downloadPath, log, yesFlag = false, isUpdate = false) => {
  const outputDir = path.join(tmpdir, "outputs");
  fs.mkdirSync(outputDir, { recursive: true });

  log.log(`Installing: ${selected.name}`);

  let installationMethod = "binary";
  let destinations = [];
  let binariesList = [];

  // Handle different file types
  switch (selected.extension) {
    case "pkg":
      installationMethod = "pkg";
      destinations = installPkg(downloadPath);
      binariesList = [selected.name];
      break;

    case "dmg":
      installationMethod = "dmg";

      const mountDir = path.join(tmpdir, "dmg-mount");
      try {
        fs.mkdirSync(mountDir, { recursive: true });
        mountDMG(downloadPath, mountDir, log);
        let dmgBinaries = getBinaries(mountDir);
        log.debug(
          `Found ${dmgBinaries.length} items in DMG: ${dmgBinaries.join(", ")}`,
        );

        const appFile = dmgBinaries.find((f) => f.endsWith(".app"));
        const pkgFile = dmgBinaries.find((f) => f.endsWith(".pkg"));

        if (appFile) {
          log.log(`Installing .app bundle: ${appFile}`);
          destinations = await installApp(appFile, mountDir, checkPath, log, null, yesFlag);
          binariesList = [appFile];

          // Skip open app prompt during updates
          if (!isUpdate && await confirm(`Open app ${path.basename(destinations[0])}?`)) {
            safeExecSync("open", ["-n", destinations[0]]);
          }
        } else if (pkgFile) {
          log.log(`Installing .pkg file: ${pkgFile}`);
          destinations = installPkg(path.join(mountDir, pkgFile));
          binariesList = [pkgFile];
        } else if (dmgBinaries.length > 0) {
          // Handle DMGs with executables but no .app or .pkg
          log.log(
            "No .app or .pkg found in DMG, trying to install executables",
          );
          const selectedBinaries = await selectBinaries(dmgBinaries, selected.name, log, yesFlag);
          const installResult = await installBinaries(
            selectedBinaries,
            mountDir,
            selected.name,
            checkPath,
            log,
            true, // isMountedVolume = true
            yesFlag
          );
          destinations = installResult.destinations;
          binariesList = installResult.cleanedBinaries;
      }
      } finally {
        // Always try to eject, even if installation failed
        ejectDMG(mountDir, log);
      }
      break;

    case "deb":
      installationMethod = "deb";
      destinations = installDeb(downloadPath);
      binariesList = [selected.name];
      break;

    case "app":
      installationMethod = "app";
      destinations = await installApp(
        path.basename(selected.name),
        path.dirname(downloadPath),
        checkPath,
        log,
        null,
        yesFlag
      );
      binariesList = [selected.name];

      // Skip open app prompt during updates
      if (!isUpdate && await confirm(`Open app ${path.basename(destinations[0])}?`, "y", yesFlag)) {
        safeExecSync("open", ["-n", destinations[0]]);
      }
      break;

    default:
      // Check if this is an installer script
      if (isInstallerScriptExtension(selected.extension) && 
          isInstallerScriptCompatible(selected.extension)) {
        const config = getInstallerScriptConfig(selected.extension);
        installationMethod = `installer_script_${selected.extension}`;
        
        log.log(`Found ${config.description}: ${selected.name}`);
        
        // Preview the script
        const preview = previewInstallerScript(downloadPath, 15);
        log.log(`\n${colors.fg.cyan}Script preview:${colors.reset}`);
        log.log(`${colors.fg.green}${preview}${colors.reset}\n`);
        
        const runScript = await confirm(
          `Run this installer script?`,
          "y",
          yesFlag
        );
        
        if (!runScript) {
          throw new Error("Installer script execution cancelled by user");
        }
        
        const result = executeInstallerScript(
          downloadPath,
          selected.extension,
          {},
          log
        );
        
        destinations = [downloadPath];
        binariesList = [selected.name];
        break;
      }
      
      // Extract archives and install binaries
      installationMethod = "binary";

      if (
        selected.extension &&
        ["tar.gz", "zip", "tar.zst", "tar.xz"].includes(selected.extension)
      ) {
        extractArchive(downloadPath, outputDir, selected.extension);
      } else {
        // Copy as-is for unknown extensions
        fs.copyFileSync(downloadPath, path.join(outputDir, selected.name));
      }

      const extractedBinaries = getBinaries(outputDir);
      log.debug(`Found ${extractedBinaries.length} binaries: ${extractedBinaries.join(", ")}`);

      if (extractedBinaries.length === 0) {
        throw new Error("No binaries found in package");
      }

      log.debug(`Found binaries: ${extractedBinaries.join(", ")}`);

      // Check if any of the extracted files are DMG or PKG packages
      const packageResult = await processExtractedPackages(
        extractedBinaries,
        outputDir,
        selected.name,
        checkPath,
        log,
        false,
        yesFlag
      );

      if (packageResult) {
        // Use the package installation result
        installationMethod = packageResult.method;
        destinations = packageResult.destinations;
        binariesList = packageResult.binaries;
        if (installationMethod === "archive_app" && !isUpdate) {
          // Skip open app prompt during updates
          if (await confirm(`Open app ${path.basename(destinations[0])}?`, "y", yesFlag)) {
            safeExecSync("open", ["-n", destinations[0]]);
          }
        }
      } else {
        // Fall back to regular binary installation
        const selectedBinaries = await selectBinaries(extractedBinaries, selected.name, log, yesFlag);
        const installResult = await installBinaries(
          selectedBinaries,
          outputDir,
          selected.name,
          checkPath,
          log,
          false,
          yesFlag
        );
        destinations = installResult.destinations;
        binariesList = installResult.cleanedBinaries;
      }
      break;
  }

  return {
    method: installationMethod,
    destinations,
    binaries: binariesList,
  };
};

const cleanup = () => {
  if (tmpdir && fs.existsSync(tmpdir)) {
    try {
      // First, try to make files writable in case they're read-only
      const { safeExecSync } = require('./utils');
      try {
        safeExecSync('chmod', ['-R', '+w', tmpdir], { stdio: 'pipe' });
      } catch (chmodError) {
        // If chmod fails, continue with cleanup attempt
      }
      
      // Attempt to remove the directory
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (e) {
      // If removal fails, try a more aggressive approach
      try {
        // Try to remove individual files first
        const files = fs.readdirSync(tmpdir, { withFileTypes: true });
        for (const file of files) {
          const filePath = path.join(tmpdir, file.name);
          try {
            if (file.isDirectory()) {
              fs.rmSync(filePath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(filePath);
            }
          } catch (fileError) {
            // Continue with other files if one fails
          }
        }
        // Try to remove the directory again
        fs.rmSync(tmpdir, { recursive: true, force: true });
      } catch (finalError) {
        // If all attempts fail, log a warning but don't crash
        const { createLogger } = require('./utils');
        const logger = createLogger();
        logger.warn(`Failed to completely clean up temporary directory: ${tmpdir}`);
        logger.warn(`Manual cleanup may be required. Error: ${finalError.message}`);
      }
    }
  }
};

module.exports = {
  performInstallation,
};
