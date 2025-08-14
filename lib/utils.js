const readline = require("readline");
const fs = require("fs");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  hidden: "\x1b[8m",

  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
    crimson: "\x1b[38m",
  },
  bg: {
    black: "\x1b[40m",
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
    white: "\x1b[47m",
    gray: "\x1b[100m",
    crimson: "\x1b[48m",
  },
};

const createLogger = () => ({
  debug: (message) => console.log(`${colors.fg.cyan}${message}${colors.reset}`),
  log: (message) => console.log(`${colors.fg.white}${message}${colors.reset}`),
  error: (message) =>
    console.error(`${colors.fg.red}${message}${colors.reset}`),
  warn: (message) =>
    console.warn(`${colors.fg.yellow}${message}${colors.reset}`),
});

const confirm = (question, defaultAnswer = "y") => {
  return new Promise((resolve) => {
    const interface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    interface.question(
      `${colors.fg.yellow}${question}${colors.reset} ${colors.fg.blue}(${
        defaultAnswer.toLowerCase() === "y" ? "Y" : "y"
      }/${defaultAnswer.toLowerCase() === "n" ? "N" : "n"})${colors.reset} `,
      (ans) => {
        let result =
          ans.trim().toLowerCase() === "y" ||
          ans.trim().toLowerCase() === "yes";
        if (defaultAnswer === "y" && ans.trim() === "") result = true;
        interface.close();
        resolve(result);
      }
    );
  });
};

const fileSize = (bytes, si = false, dp = 1) => {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + " B";
  }

  const units = si
    ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );

  return bytes.toFixed(dp) + " " + units[u];
};

const createLink = (text, url) => {
  const OSC = "\u001B]";
  const SEP = ";";
  const BEL = "\u0007";
  return [OSC, "8", SEP, SEP, url, BEL, text, OSC, "8", SEP, SEP, BEL].join("");
};

const checkPath = async (p) => {
  if (fs.existsSync(p)) {
    if (!(await confirm(`Overwrite ${p}?`))) {
      throw new Error("Aborted overwrite of file " + p);
    } else {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch (e) {
        // Ignore removal errors
      }
    }
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const processInstallSnippetReplacements = (code) => {
  const replacements = [
    [/^\$ +/, ""],
    ["npm install", "pnpm i"],
    ["yarn install", "pnpm i"],
  ];

  let result = code;
  for (let [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
};

const parseFlags = (args) => {
  const flags = {};
  const remainingArgs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const flagName = arg.substring(2);
      if (flagName === "update") {
        flags.update = true;
        // Check if next arg is a package name
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.updatePackage = args[i + 1];
          i++; // Skip the package name in next iteration
        }
      } else if (flagName === "help") {
        flags.help = true;
      } else if (flagName === "list") {
        flags.list = true;
      } else if (flagName === "search") {
        flags.search = true;
      } else if (flagName === "first") {
        // --first requires a search query
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.first = args[i + 1];
          i++; // Skip the search query in next iteration
        } else {
          throw new Error("--first requires a search query");
        }
      }
    } else if (arg.startsWith("-")) {
      const shortFlags = arg.substring(1);
      for (const char of shortFlags) {
        if (char === "h") flags.help = true;
      }
    } else {
      remainingArgs.push(arg);
    }
  }

  return { flags, remainingArgs };
};

module.exports = {
  colors,
  createLogger,
  confirm,
  fileSize,
  createLink,
  checkPath,
  sleep,
  processInstallSnippetReplacements,
  parseFlags,
};
