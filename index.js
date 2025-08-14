const { performInstallation } = require("./lib/installer");
const {
  checkForUpdates,
  performUpdate,
  listInstalled,
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
} = require("./lib/utils");

const HELP = `justinstall <github-url|file-url|local-file> [options]
\tv1.1.0 - Just install anything. Supports .tar.gz, .zip, .dmg, .app, .pkg, and .deb files. 
\tBinaries will be installed to ~/.local/bin.

\tOptions:
\t  --search [query]     Interactive search for GitHub repositories, or direct search with query
\t  --first <query>      Find and install most-starred repo matching query
\t  --update [package]   Update all packages or specific package
\t  --list               List installed packages
\t  -h, --help           Show this help

\tExamples:
\t  justinstall atuinsh/atuin
\t  justinstall https://github.com/junegunn/fzf/
\t  justinstall https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg
\t  justinstall tailscale.pkg
\t  justinstall --search
\t  justinstall --search "terminal multiplexer"
\t  justinstall --first "terminal multiplexer"
\t  justinstall --update
\t  justinstall --update tailscale
\t  justinstall --update tailscale ./new-tailscale.pkg

\tMade by ${createLink(
  "Explosion-Scratch",
  "https://github.com/explosion-scratch"
)}`;

const handleUpdateCommand = async (flags, args) => {
  const log = createLogger();

  if (flags.updatePackage) {
    // Update specific package
    const customFilePath = args[0]; // Optional custom file path

    log.debug(`Checking for updates: ${flags.updatePackage}`);
    const updates = await checkForUpdates(flags.updatePackage);

    if (updates.length === 0) {
      log.log(`${flags.updatePackage} is already up to date`);
      return;
    }

    const updateInfo = updates[0];
    if (!updateInfo.canUpdate) {
      log.warn(
        `Update available for ${flags.updatePackage} but ${updateInfo.reason}`
      );
      return;
    }

    log.log(
      `Update available for ${flags.updatePackage}: ${updateInfo.reason}`
    );
    if (await confirm(`Proceed with update?`)) {
      await performUpdate(updateInfo, customFilePath);
    }
  } else {
    // Update all packages
    log.debug("Checking for updates for all packages...");
    const updates = await checkForUpdates();

    if (updates.length === 0) {
      log.log("All packages are up to date");
      return;
    }

    log.log(`Found ${updates.length} package(s) with updates:`);
    for (const update of updates) {
      log.log(`  ${update.name}: ${update.reason}`);
    }

    if (await confirm(`Update all ${updates.length} package(s)?`)) {
      for (const update of updates) {
        if (update.canUpdate) {
          try {
            await performUpdate(update);
          } catch (error) {
            log.error(`Failed to update ${update.name}: ${error.message}`);
          }
        }
      }
    }
  }
};

const main = async () => {
  const log = createLogger();
  const args = process.argv.slice(2);
  const { flags, remainingArgs } = parseFlags(args);

  if (flags.help) {
    log.log(HELP);
    return;
  }

  if (flags.update !== undefined) {
    await handleUpdateCommand(flags, remainingArgs);
    return;
  }

  if (flags.list) {
    listInstalled();
    return;
  }

  if (flags.search) {
    if (flags.searchQuery) {
      // Direct search with query
      const repos = await displaySearchResults(flags.searchQuery);
      if (repos && repos.length > 0) {
        const log = createLogger();
        if (
          await confirm(`Install the first result (${repos[0].full_name})?`)
        ) {
          await performInstallation([repos[0].full_name]);
        } else {
          // If user doesn't want the first result, show interactive selection
          const selectedRepo = await selectRepositoryFromResults(
            repos,
            flags.searchQuery
          );
          if (selectedRepo) {
            await performInstallation([selectedRepo.full_name]);
          }
        }
      }
    } else {
      // Interactive search
      const selectedRepo = await interactiveSearch();
      if (selectedRepo) {
        await performInstallation([selectedRepo.full_name]);
      }
    }
    return;
  }

  if (flags.first) {
    const repo = await findFirstRepository(flags.first);
    await performInstallation([repo.full_name]);
    return;
  }

  if (remainingArgs.length === 0) {
    log.log(HELP);
    return;
  }

  await performInstallation(remainingArgs);
};

// Main execution
(async () => {
  process.on("SIGINT", () => {
    process.exit(0);
  });

  try {
    await main();
  } catch (error) {
    const log = createLogger();
    log.error(error.message);
    process.exit(1);
  }
})();
