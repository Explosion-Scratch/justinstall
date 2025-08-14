const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const {
  parseSource,
  getGitHubAssets,
  downloadFromUrl,
  findInstallScripts,
} = require("./sources");
const {
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
} = require("./installers");
const {
  createInstallationRecord,
  addInstallation,
  hashFile,
  extractName,
} = require("./config");
const {
  createLogger,
  confirm,
  fileSize,
  checkPath,
  processInstallSnippetReplacements,
  promptChoice,
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

const performInstallation = async (args, isUpdate = false) => {
  const log = createLogger();

  if (args.length === 0) {
    throw new Error("No installation source provided");
  }

  const source = parseSource(args[0]);
  const customFilePath = args[1]; // For update with custom file path

  tmpdir = execSync("mktemp -d").toString().trim();
  process.chdir(tmpdir);

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
      case "github":
        const result = await handleGitHubSource(
          source,
          platformInfo,
          capabilities,
          log
        );
        selected = result.selected;
        releaseInfo = result.releaseInfo;
        break;
    }

    if (!selected) {
      throw new Error("No suitable package found");
    }

    const shouldInstall = await confirm(
      `Ok to ${isUpdate ? "update" : "install"} ${selected.name} (${fileSize(
        selected.size
      )})?`
    );

    if (!shouldInstall) {
      throw new Error(`Aborted ${isUpdate ? "update" : "installation"}`);
    }

    downloadPath = await downloadSelected(selected, source, log);
    const installationResult = await installSelected(
      selected,
      downloadPath,
      log
    );

    if (!isUpdate) {
      // Save installation record
      const fileHash = hashFile(downloadPath);
      const installRecord = createInstallationRecord(source, selected, {
        name: extractName(selected),
        hash: fileHash,
        installMethod: installationResult.method,
        binaries: installationResult.binaries,
        destinations: installationResult.destinations,
        version: releaseInfo.tag,
        commit: releaseInfo.commit,
      });

      addInstallation(installRecord);
    }

    log.log(
      `Successfully ${
        isUpdate ? "updated" : "installed"
      }: ${installationResult.binaries.join(", ")}`
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
  return {
    name: path.basename(filePath),
    size: stats.size,
    extension: require("./sources").getExtension(path.basename(filePath)),
    localPath: filePath,
  };
};

const handleUrlSource = async (source, log) => {
  log.debug("Downloading file from URL...");

  const tempFilename = path.join(tmpdir, "download");
  const { filename, size } = await downloadFromUrl(source.url, tempFilename);

  log.debug(`Downloaded ${filename}`);

  return {
    name: filename,
    size: size,
    extension: require("./sources").getExtension(filename),
    browser_download_url: source.url,
    localPath: tempFilename,
  };
};

const displayScriptPreview = (script, log) => {
  const { code, source, score } = script;
  log.debug(
    `Found installer code in ${source} (score: ${score}):\n\n\t` +
      colors.fg.green +
      code +
      colors.reset +
      "\n"
  );
};

const truncatePreview = (
  text,
  maxLength = SCRIPT_PREVIEW_CONFIG.MAX_LENGTH
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
      `  ${index + 1}. [Score: ${script.score}] ${script.source}: ${preview}`
    );
  });

  const continueOption = installScripts.length + 1;
  const exitOption = installScripts.length + 2;

  log.log(`  ${continueOption}. Continue to regular installation`);
  log.log(`  ${exitOption}. Exit installation`);
};

const handleSingleScript = async (script, log) => {
  displayScriptPreview(script, log);

  const shouldRun = await confirm(
    "Run install script (y) or continue to regular installation (n)?"
  );

  return shouldRun ? script : null;
};

const handleMultipleScripts = async (installScripts, log) => {
  const CONTINUE_OPTION = installScripts.length + 1;
  const EXIT_OPTION = installScripts.length + 2;

  while (true) {
    displayScriptList(installScripts, log);

    const choice = await promptChoice(
      `Preview install script (1-${EXIT_OPTION}): `,
      EXIT_OPTION
    );

    if (choice <= installScripts.length) {
      const script = installScripts[choice - 1];
      displayScriptPreview(script, log);

      const shouldRun = await confirm(
        "Run this install script (y) or choose a different one (n)?"
      );

      if (shouldRun) return script;
      // Continue loop if user chooses 'n'
    } else if (choice === CONTINUE_OPTION) {
      return null; // Continue to regular installation
    } else if (choice === EXIT_OPTION) {
      throw new Error("Installation aborted by user");
    }
  }
};

const selectInstallScript = async (installScripts, log) => {
  if (installScripts.length === 0) return null;

  if (installScripts.length === 1) {
    return await handleSingleScript(installScripts[0], log);
  }

  return await handleMultipleScripts(installScripts, log);
};

const executeInstallScript = (script, log) => {
  log.debug("Running install script...");
  const processedCode = processInstallSnippetReplacements(script.code);
  execSync(processedCode, { stdio: "inherit" });
};

const handleGitHubSource = async (source, platformInfo, capabilities, log) => {
  const { assets, body, tag, commit } = await getGitHubAssets(
    source.owner,
    source.repo
  );

  log.debug(`Found ${assets.length} assets`);

  // Check for install scripts first
  const installScripts = await findInstallScripts(
    source.owner,
    source.repo,
    body
  );

  if (installScripts.length > 0) {
    log.debug(`Found ${installScripts.length} install script(s)`);

    const selectedScript = await selectInstallScript(installScripts, log);

    if (selectedScript) {
      executeInstallScript(selectedScript, log);

      // For script installations, we still want to record it
      const installRecord = createInstallationRecord(
        source,
        { name: `${source.owner}/${source.repo}` },
        {
          name: source.repo,
          installMethod: "script",
          version: tag,
          commit: commit,
        }
      );
      addInstallation(installRecord);

      return;
    }
  }

  // Check for installer.sh in assets
  const installerScript = assets.find((i) => i.name.includes("installer.sh"));
  if (installerScript) {
    log.debug(`Found installer script: ${installerScript.name}`);

    if (await confirm(`Run install script? ${installerScript.name}`)) {
      const scriptPath = path.join(tmpdir, "installer.sh");
      const { size } = await downloadFromUrl(
        installerScript.browser_download_url,
        scriptPath
      );
      execSync(`chmod +x ${JSON.stringify(scriptPath)}`);
      execSync(scriptPath, { stdio: "inherit" });

      const installRecord = createInstallationRecord(source, installerScript, {
        name: source.repo,
        installMethod: "installer_script",
        version: tag,
        commit: commit,
      });
      addInstallation(installRecord);

      return;
    }
  }

  // Regular asset installation
  const selected = selectBestAsset(assets, platformInfo, capabilities);

  if (!selected) {
    throw new Error(
      `Couldn't find a compatible binary for ${platformInfo.platform}/${platformInfo.arch}. ` +
        `Check manually: https://github.com/${source.owner}/${source.repo}/releases`
    );
  }

  return {
    selected,
    releaseInfo: { tag, commit, body },
  };
};

const downloadSelected = async (selected, source, log) => {
  if (selected.localPath) {
    // File or already downloaded
    return selected.localPath;
  }

  const downloadPath = path.join(tmpdir, selected.name);
  log.debug(`Downloading ${selected.name}`);

  await downloadFromUrl(selected.browser_download_url, downloadPath);
  return downloadPath;
};

const installSelected = async (selected, downloadPath, log) => {
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
      mountDMG(downloadPath, outputDir);
      const dmgBinaries = getBinaries(outputDir);

      const appFile = dmgBinaries.find((f) => f.endsWith(".app"));
      const pkgFile = dmgBinaries.find((f) => f.endsWith(".pkg"));

      if (appFile) {
        destinations = await installApp(appFile, outputDir, checkPath);
        binariesList = [appFile];

        // Ask to open app
        if (await confirm(`Open app ${path.basename(destinations[0])}?`)) {
          execSync(`open -n ${JSON.stringify(destinations[0])}`);
        }
      } else if (pkgFile) {
        destinations = installPkg(path.join(outputDir, pkgFile));
        binariesList = [pkgFile];
      }

      ejectDMG(outputDir);
      break;

    case "deb":
      installationMethod = "deb";
      destinations = installDeb(downloadPath);
      binariesList = [selected.name];
      break;

    case "app":
      installationMethod = "app";
      destinations = await installApp(
        selected.name,
        path.dirname(downloadPath),
        checkPath
      );
      binariesList = [selected.name];
      break;

    default:
      // Extract archives and install binaries
      installationMethod = "binary";

      if (
        selected.extension &&
        ["tar.gz", "zip", "tar.zst"].includes(selected.extension)
      ) {
        extractArchive(downloadPath, outputDir, selected.extension);
      } else {
        // Copy as-is for unknown extensions
        fs.copyFileSync(downloadPath, path.join(outputDir, selected.name));
      }

      const extractedBinaries = getBinaries(outputDir);

      if (extractedBinaries.length === 0) {
        throw new Error("No binaries found in package");
      }

      log.debug(`Found binaries: ${extractedBinaries.join(", ")}`);
      destinations = await installBinaries(
        extractedBinaries,
        outputDir,
        selected.name,
        checkPath
      );
      binariesList = extractedBinaries.map((bin) => path.basename(bin));
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
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
};

module.exports = {
  performInstallation,
};
