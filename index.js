#!/usr/bin/env node

const path = require("path");
const { performInstallation } = require("./lib/installer");
const {
  checkForUpdates,
  performUpdate,
  listInstalled,
  performUninstall,
} = require("./lib/updater");
const {
  interactiveSearch,
  findFirstRepository,
  displaySearchResults,
  selectRepositoryFromResults,
} = require("./lib/search");
const {
  createLogger,
  createLink,
  parseFlags,
  confirm,
  colors,
} = require("./lib/utils");
const { createMultiSelect, createModuleProgress } = require("./lib/progress");
const { detectOrphanedInstallations } = require("./lib/system");
const { loadConfig } = require("./lib/config");

const getVersion = () => {
  try {
    const packageJson = require(path.join(__dirname, "package.json"));
    return packageJson.version || "unknown";
  } catch {
    return "unknown";
  }
};

const VERSION = getVersion();

const HELP = `justinstall <github-url|website-url|file-url|local-file> [options]
\t${VERSION} - Just install anything. Supports .tar.gz, .zip, .dmg, .app, .pkg, and .deb files. 
\tZIP files containing DMG or PKG packages are automatically detected and installed.
\tBinaries will be installed to ~/.local/bin.

\tGitHub Release Strategy:
\t  - Prefers stable releases over prereleases
\t  - Falls back to latest prerelease if no stable releases exist
\t  - Supports specific release URLs

\tOptions:
\t  --search [query]     Interactive search for GitHub repositories, or direct search with query
\t  --first <query>      Find and install most-starred repo matching query
\t  --update [package]   Update all packages or specific package
\t  --uninstall [name]   Uninstall a previously installed package (interactive if no name provided)
\t  --list               List installed packages
\t  --yes                Answer yes to all prompts
\t  --version            Show version
\t  -h, --help           Show this help

\tExamples:
\t  justinstall atuinsh/atuin
\t  justinstall https://github.com/junegunn/fzf/
\t  justinstall https://github.com/Explosion-Scratch/whisper-mac
\t  justinstall https://example.com/downloads/
\t  justinstall https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg
\t  justinstall tailscale.pkg
\t  justinstall --search
\t  justinstall --search "terminal multiplexer"
\t  justinstall --first "terminal multiplexer"
\t  justinstall --update
\t  justinstall --update tailscale
\t  justinstall --update tailscale ./new-tailscale.pkg
\t  justinstall --uninstall
\t  justinstall --uninstall tailscale

\tMade by ${createLink(
  "Explosion-Scratch",
  "https://github.com/explosion-scratch"
)}`;

const handleUpdateCommand = async (flags, args) => {
  const log = createLogger();
  const progress = createModuleProgress();

  if (flags.updatePackage) {
    progress.startModule("Checking for updates", flags.updatePackage);
    const customFilePath = args[0];

    const updateInfo = await checkForUpdates(flags.updatePackage);
    progress.completeModule(true);

    if (updateInfo.hasUpdate === false && !updateInfo.error) {
      log.log(`${colors.fg.green}✓${colors.reset} ${flags.updatePackage} is already up to date`);
      return;
    }

    const unverifiable =
      updateInfo.error === true ||
      updateInfo.hasUpdate === undefined ||
      updateInfo.canUpdate === undefined;

    if (unverifiable) {
      log.warn(
        `Unable to verify current version for ${flags.updatePackage}. Will reinstall to ensure freshness.`
      );
      if (await confirm(`Proceed to reinstall ${flags.updatePackage}?`, "y", flags.yes)) {
        progress.startModule("Reinstalling", flags.updatePackage);
        await performUpdate(
          {
            name: flags.updatePackage,
            source: updateInfo.source,
          },
          customFilePath,
          true
        );
        progress.completeModule(true);
      }
      return;
    }

    if (!updateInfo.canUpdate) {
      log.warn(
        `${colors.fg.yellow}⚠${colors.reset} Update available for ${flags.updatePackage} but ${updateInfo.reason}`
      );
      return;
    }

    log.log(
      `${colors.fg.cyan}↑${colors.reset} Update available for ${flags.updatePackage}: ${updateInfo.reason}`
    );
    if (await confirm(`Proceed with update?`, "y", flags.yes)) {
      progress.startModule("Updating", flags.updatePackage);
      await performUpdate(updateInfo, customFilePath, true);
      progress.completeModule(true);
    }
  } else {
    progress.startModule("Checking for updates", "all packages");
    const updates = await checkForUpdates();
    progress.completeModule(true);

    progress.startModule("Checking for orphaned installations");
    const config = loadConfig();
    const orphaned = detectOrphanedInstallations(config);
    progress.completeModule(true, orphaned.length > 0 ? `Found ${orphaned.length} orphaned` : "None found");

    if (orphaned.length > 0) {
      log.log(`\n${colors.fg.yellow}Found ${orphaned.length} orphaned installation(s):${colors.reset}`);
      for (const orphan of orphaned) {
        log.log(`  ${colors.fg.red}✗${colors.reset} ${orphan.name}: ${orphan.reason}`);
      }

      if (await confirm(`\nRemove orphaned installation records?`, "y", flags.yes)) {
        const { removeInstallation } = require("./lib/config");
        for (const orphan of orphaned) {
          removeInstallation(orphan.name);
          log.log(`  Removed record: ${orphan.name}`);
        }
      }
    }

    if (updates.length === 0) {
      log.log(`\n${colors.fg.green}✓${colors.reset} All packages are up to date`);
      return;
    }

    log.log(`\n${colors.fg.cyan}Found ${updates.length} package(s) with updates:${colors.reset}`);
    for (const update of updates) {
      const canUpdateIcon = update.canUpdate
        ? `${colors.fg.green}↑${colors.reset}`
        : `${colors.fg.yellow}⚠${colors.reset}`;
      log.log(`  ${canUpdateIcon} ${update.name}: ${update.reason}`);
    }

    const updatablePackages = updates.filter((u) => u.canUpdate);

    if (updatablePackages.length === 0) {
      log.log(`\n${colors.fg.yellow}No packages can be automatically updated${colors.reset}`);
      return;
    }

    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const choice = await new Promise((resolve) => {
      if (flags.yes) {
        resolve("all");
        return;
      }
      rl.question(
        `\n${colors.fg.yellow}Update options:${colors.reset} (a)ll ${updatablePackages.length} packages, (s)elect which to update, (n)one? `,
        (ans) => {
          rl.close();
          resolve(ans.trim().toLowerCase());
        }
      );
    });

    if (choice === "n" || choice === "no" || choice === "none") {
      log.log("Update cancelled");
      return;
    }

    let packagesToUpdate = updatablePackages;

    if (choice === "s" || choice === "select" || choice === "some") {
      const selectedItems = await createMultiSelect(
        updatablePackages.map((u) => ({
          label: `${u.name} - ${u.reason}`,
          value: u,
        })),
        "Select packages to update:"
      );

      if (selectedItems.length === 0) {
        log.log("No packages selected");
        return;
      }

      packagesToUpdate = selectedItems.map((item) => item.value);
    }

    log.log(`\n${colors.fg.cyan}Updating ${packagesToUpdate.length} package(s)...${colors.reset}\n`);

    for (let i = 0; i < packagesToUpdate.length; i++) {
      const update = packagesToUpdate[i];
      progress.startModule(
        `Updating (${i + 1}/${packagesToUpdate.length})`,
        update.name
      );

      try {
        await performUpdate(update, null, true);
        progress.completeModule(true);
      } catch (error) {
        progress.completeModule(false, error.message);
        log.error(`Failed to update ${update.name}: ${error.message}`);
      }
    }

    log.log(`\n${colors.fg.green}✓${colors.reset} Update complete`);
  }
};

const handleUninstallCommand = async (flags) => {
  const log = createLogger();
  const config = loadConfig();

  if (!flags.uninstallPackage) {
    if (config.length === 0) {
      log.log(`${colors.fg.yellow}No packages installed via justinstall${colors.reset}`);
      log.log(`\nTo install a package, run: ${colors.fg.cyan}justinstall <github-repo>${colors.reset}`);
      return;
    }

    log.log(`${colors.fg.cyan}Select packages to uninstall:${colors.reset}\n`);

    const selectedItems = await createMultiSelect(
      config.map((item) => {
        const versionInfo = item.version ? ` (${item.version})` : "";
        return {
          label: `${item.name}${versionInfo}`,
          value: item,
        };
      }),
      "Select packages to uninstall:"
    );

    if (selectedItems.length === 0) {
      log.log("No packages selected");
      return;
    }

    const progress = createModuleProgress();

    for (let i = 0; i < selectedItems.length; i++) {
      const item = selectedItems[i].value;
      progress.startModule(
        `Uninstalling (${i + 1}/${selectedItems.length})`,
        item.name
      );

      try {
        await performUninstall(item.name, true);
        progress.completeModule(true);
      } catch (error) {
        progress.completeModule(false, error.message);
        log.error(`Failed to uninstall ${item.name}: ${error.message}`);
      }
    }

    log.log(`\n${colors.fg.green}✓${colors.reset} Uninstall complete`);
    return;
  }

  await performUninstall(flags.uninstallPackage, flags.yes);
};

const main = async () => {
  const log = createLogger();
  const args = process.argv.slice(2);
  const { flags, remainingArgs } = parseFlags(args);

  if (flags.help) {
    log.log(HELP);
    return;
  }

  if (flags.version) {
    log.log(`justinstall ${VERSION}`);
    return;
  }

  if (flags.update !== undefined) {
    await handleUpdateCommand(flags, remainingArgs);
    return;
  }

  if (flags.uninstall) {
    await handleUninstallCommand(flags);
    return;
  }

  if (flags.list) {
    listInstalled();
    return;
  }

  if (flags.search) {
    if (flags.searchQuery) {
      const repos = await displaySearchResults(flags.searchQuery);
      if (repos && repos.length > 0) {
        if (
          await confirm(`Install the first result (${repos[0].full_name})?`, "y", flags.yes)
        ) {
          await performInstallation([repos[0].full_name]);
        } else {
          const selectedRepo = await selectRepositoryFromResults(
            repos,
            flags.searchQuery
          );
          if (selectedRepo) {
            await performInstallation([selectedRepo.full_name]);
          }
        }
      } else if (!repos || repos.length === 0) {
        log.log(`\n${colors.fg.yellow}No repositories found matching "${flags.searchQuery}"${colors.reset}`);
        log.log(`\nTry a different search term or browse GitHub directly:`);
        log.log(`  ${colors.fg.cyan}https://github.com/search?q=${encodeURIComponent(flags.searchQuery)}&type=repositories${colors.reset}`);
      }
    } else {
      const selectedRepo = await interactiveSearch();
      if (selectedRepo) {
        await performInstallation([selectedRepo.full_name]);
      }
    }
    return;
  }

  if (flags.first) {
    const repo = await findFirstRepository(flags.first);
    await performInstallation([repo.full_name], false, flags.yes);
    return;
  }

  if (remainingArgs.length === 0) {
    log.log(HELP);
    return;
  }

  await performInstallation(remainingArgs, false, flags.yes);
};

(async () => {
  process.on("SIGINT", () => {
    process.exit(0);
  });

  try {
    await main();
  } catch (error) {
    const log = createLogger();

    if (error.message.includes("not found")) {
      log.error(`${colors.fg.red}Error:${colors.reset} ${error.message}`);
      log.log(`\n${colors.fg.yellow}Troubleshooting tips:${colors.reset}`);
      log.log(`  • Check that the package name or URL is correct`);
      log.log(`  • Try searching: ${colors.fg.cyan}justinstall --search <query>${colors.reset}`);
      log.log(`  • Check GitHub releases page directly`);
    } else if (error.message.includes("No suitable package") || error.message.includes("No compatible")) {
      log.error(`${colors.fg.red}Error:${colors.reset} ${error.message}`);
      log.log(`\n${colors.fg.yellow}This package may not have compatible releases for your system${colors.reset}`);
      log.log(`Platform: ${process.platform}, Architecture: ${process.arch}`);
    } else if (error.message.includes("sudo") || error.message.includes("permission")) {
      log.error(`${colors.fg.red}Permission error:${colors.reset} ${error.message}`);
      log.log(`\n${colors.fg.yellow}Try running with administrator privileges${colors.reset}`);
    } else {
      log.error(`${colors.fg.red}Error:${colors.reset} ${error.message}`);
      if (process.env.DEBUG) {
        log.error(error.stack);
      }
    }
    process.exit(1);
  }
})();
