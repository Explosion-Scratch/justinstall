const readline = require("readline");
const { createLogger } = require("./utils");

/**
 * Search GitHub repositories
 */
const searchRepositories = async (query, options = {}) => {
  const { sort = "stars", order = "desc", per_page = 30 } = options;

  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set("sort", sort);
  url.searchParams.set("order", order);
  url.searchParams.set("per_page", per_page);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.items;
};

/**
 * Interactive search interface
 */
const interactiveSearch = async () => {
  const log = createLogger();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    const askForQuery = () => {
      rl.question("Enter search query (or 'q' to quit): ", async (query) => {
        if (query.toLowerCase() === "q" || query.toLowerCase() === "quit") {
          rl.close();
          resolve(null);
          return;
        }

        if (!query.trim()) {
          log.warn("Please enter a search query");
          askForQuery();
          return;
        }

        try {
          log.debug(`Searching for: ${query}`);
          const repos = await searchRepositories(query);

          if (repos.length === 0) {
            log.warn("No repositories found");
            askForQuery();
            return;
          }

          log.log("\nFound repositories:");
          repos.slice(0, 10).forEach((repo, index) => {
            log.log(
              `${index + 1}. ${repo.full_name} (⭐ ${repo.stargazers_count})`
            );
            log.log(`   ${repo.description || "No description"}`);
            log.log("");
          });

          selectRepository(repos.slice(0, 10), rl, resolve, reject);
        } catch (error) {
          log.error(`Search failed: ${error.message}`);
          askForQuery();
        }
      });
    };

    askForQuery();
  });
};

/**
 * Repository selection interface
 */
const selectRepository = (repos, rl, resolve, reject) => {
  const log = createLogger();

  rl.question(
    "Select repository (1-10, 's' for new search, 'q' to quit): ",
    (choice) => {
      if (choice.toLowerCase() === "q" || choice.toLowerCase() === "quit") {
        rl.close();
        resolve(null);
        return;
      }

      if (choice.toLowerCase() === "s" || choice.toLowerCase() === "search") {
        rl.question("Enter search query: ", async (query) => {
          try {
            const newRepos = await searchRepositories(query);
            if (newRepos.length === 0) {
              log.warn("No repositories found");
              selectRepository(repos, rl, resolve, reject);
              return;
            }

            log.log("\nFound repositories:");
            newRepos.slice(0, 10).forEach((repo, index) => {
              log.log(
                `${index + 1}. ${repo.full_name} (⭐ ${repo.stargazers_count})`
              );
              log.log(`   ${repo.description || "No description"}`);
              log.log("");
            });

            selectRepository(newRepos.slice(0, 10), rl, resolve, reject);
          } catch (error) {
            log.error(`Search failed: ${error.message}`);
            selectRepository(repos, rl, resolve, reject);
          }
        });
        return;
      }

      const index = parseInt(choice) - 1;
      if (isNaN(index) || index < 0 || index >= repos.length) {
        log.warn("Invalid selection");
        selectRepository(repos, rl, resolve, reject);
        return;
      }

      rl.close();
      resolve(repos[index]);
    }
  );
};

/**
 * Find first (most starred) repository matching search term
 */
const findFirstRepository = async (searchTerm) => {
  const log = createLogger();

  // Search for repositories with the term in the name/description
  const query = `${searchTerm} in:name,description`;

  log.debug(`Searching for repositories with: ${searchTerm}`);
  const repos = await searchRepositories(query, {
    sort: "stars",
    order: "desc",
    per_page: 1,
  });

  if (repos.length === 0) {
    throw new Error(`No repositories found matching "${searchTerm}"`);
  }

  const repo = repos[0];
  log.log(`Found: ${repo.full_name} (⭐ ${repo.stargazers_count})`);
  log.log(`Description: ${repo.description || "No description"}`);

  return repo;
};

module.exports = {
  searchRepositories,
  interactiveSearch,
  findFirstRepository,
};
