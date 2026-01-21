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

const LOG_LEVELS = {
  DEBUG: 0,
  LOG: 1,
  ERROR: 2,
  WARN: 3,
};

const createLogger = (level = LOG_LEVELS.LOG) => ({
  debug: (message) =>
    level <= LOG_LEVELS.DEBUG &&
    console.log(`${colors.fg.cyan}${message}${colors.reset}`),
  log: (message) =>
    level <= LOG_LEVELS.LOG &&
    console.log(`${colors.fg.white}${message}${colors.reset}`),
  error: (message) =>
    level <= LOG_LEVELS.ERROR &&
    console.error(`${colors.fg.red}${message}${colors.reset}`),
  warn: (message) =>
    level <= LOG_LEVELS.WARN &&
    console.warn(`${colors.fg.yellow}${message}${colors.reset}`),
});

const confirm = (question, defaultAnswer = "y", yesFlag = false) => {
  if (yesFlag) {
    return Promise.resolve(true);
  }
  
  return new Promise((resolve) => {
    const rli = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rli.question(
      `${colors.fg.yellow}${question}${colors.reset} ${colors.fg.blue}(${defaultAnswer.toLowerCase() === "y" ? "Y" : "y"
      }/${defaultAnswer.toLowerCase() === "n" ? "N" : "n"})${colors.reset} `,
      (ans) => {
        let result =
          ans.trim().toLowerCase() === "y" ||
          ans.trim().toLowerCase() === "yes";
        if (defaultAnswer === "y" && ans.trim() === "") result = true;
        rli.close();
        resolve(result);
      }
    );
  });
};

const promptChoice = (question, maxChoice, yesFlag = false) => {
  if (maxChoice < 1) {
    throw new Error("maxChoice must be at least 1");
  }

  if (yesFlag) {
    return Promise.resolve(1); // Return first choice by default
  }

  return new Promise((resolve) => {
    const askQuestion = () => {
      const rli = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rli.question(`${colors.fg.yellow}${question}${colors.reset} `, (ans) => {
        const choice = parseInt(ans.trim());
        rli.close();

        if (isNaN(choice) || choice < 1 || choice > maxChoice) {
          console.log(
            `${colors.fg.red}Invalid choice. Please enter a number between 1 and ${maxChoice}.${colors.reset}`
          );
          // Use setTimeout to avoid stack overflow
          setTimeout(askQuestion, 0);
        } else {
          resolve(choice);
        }
      });
    };

    askQuestion();
  });
};

const promptChoiceWithEdit = (question, maxChoice, allowEdit = false, yesFlag = false) => {
  if (maxChoice < 1) {
    throw new Error("maxChoice must be at least 1");
  }

  if (yesFlag) {
    return Promise.resolve(1); // Return first choice by default
  }

  return new Promise((resolve) => {
    const askQuestion = () => {
      const rli = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      let editPrompt = "";
      if (allowEdit) {
        editPrompt = ` or 'e' to edit`;
      }

      rli.question(`${colors.fg.yellow}${question}${editPrompt}${colors.reset} `, (ans) => {
        const trimmed = ans.trim().toLowerCase();
        rli.close();

        if (allowEdit && trimmed === 'e') {
          resolve('edit');
          return;
        }

        const choice = parseInt(trimmed);
        if (isNaN(choice) || choice < 1 || choice > maxChoice) {
          console.log(
            `${colors.fg.red}Invalid choice. Please enter a number between 1 and ${maxChoice}${allowEdit ? " or 'e' to edit" : ""}.${colors.reset}`
          );
          // Use setTimeout to avoid stack overflow
          setTimeout(askQuestion, 0);
        } else {
          resolve(choice);
        }
      });
    };

    askQuestion();
  });
};

const editScriptInEditor = async (script) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  // Create a temporary file with the script content
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `justinstall-script-${Date.now()}.sh`);
  
  try {
    fs.writeFileSync(tempFile, script.code);
    
    // Determine the default editor
    const editor = process.env.EDITOR || process.env.VISUAL || 'nano';
    
    console.log(`${colors.fg.cyan}Opening editor: ${editor}${colors.reset}`);
    
    // Open the editor and wait for it to close
    safeExecSync(editor, [tempFile], { stdio: 'inherit' });
    
    // Read the modified content
    const modifiedCode = fs.readFileSync(tempFile, 'utf8');
    
    // Return the updated script
    return {
      ...script,
      code: modifiedCode
    };
  } catch (error) {
    console.error(`${colors.fg.red}Error opening editor: ${error.message}${colors.reset}`);
    return script; // Return original script if editing fails
  } finally {
    // Clean up the temporary file
    try {
      fs.unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
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

const checkPath = async (p, yesFlag = false) => {
  if (fs.existsSync(p)) {
    if (!(await confirm(`Overwrite ${p}?`, "y", yesFlag))) {
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
      } else if (flagName === "uninstall") {
        flags.uninstall = true;
        // Check if next arg is a package name
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.uninstallPackage = args[i + 1];
          i++; // Skip the package name in next iteration
        }
      } else if (flagName === "help") {
        flags.help = true;
      } else if (flagName === "list") {
        flags.list = true;
      } else if (flagName === "search") {
        flags.search = true;
        // Check if next arg is a search query
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.searchQuery = args[i + 1];
          i++; // Skip the search query in next iteration
        }
      } else if (flagName === "first") {
        // --first requires a search query
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.first = args[i + 1];
          i++; // Skip the search query in next iteration
        } else {
          throw new Error("--first requires a search query");
        }
      } else if (flagName === "yes") {
        flags.yes = true;
      } else if (flagName === "version") {
        flags.version = true;
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

const safeExecSync = (command, args = [], options = {}) => {
  const { execSync } = require('child_process');
  
  // Validate inputs
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Command must be a non-empty string');
  }
  
  if (!Array.isArray(args)) {
    throw new Error('Arguments must be an array');
  }
  
  // Sanitize each argument
  const sanitizedArgs = args.map(arg => {
    if (arg === null || arg === undefined) {
      return '';
    }
    
    // Convert to string and escape any shell metacharacters
    const str = String(arg);
    // Escape shell metacharacters by wrapping in single quotes and escaping existing single quotes
    return str.replace(/'/g, "'\\''").replace(/[^a-zA-Z0-9._\-\/:@=]/g, (match) => {
      // For characters that need escaping, wrap in single quotes
      return `'${match.replace(/'/g, "'\\''")}'`;
    });
  });
  
  // Build the command string safely
  const commandString = [command, ...sanitizedArgs].join(' ');
  
  // Default options for security
  const defaultOptions = {
    stdio: 'pipe',
    encoding: 'utf8',
    maxBuffer: 1024 * 1024, // 1MB buffer limit
    timeout: 300000, // 5 minute timeout
    ...options
  };
  
  try {
    return execSync(commandString, defaultOptions);
  } catch (error) {
    // Enhance error with command information for debugging
    error.message = `Command failed: ${commandString}\n${error.message}`;
    throw error;
  }
};

const safeExec = (command, args = [], options = {}) => {
  const { exec } = require('child_process');
  
  // Validate inputs
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Command must be a non-empty string');
  }
  
  if (!Array.isArray(args)) {
    throw new Error('Arguments must be an array');
  }
  
  // Sanitize each argument
  const sanitizedArgs = args.map(arg => {
    if (arg === null || arg === undefined) {
      return '';
    }
    
    const str = String(arg);
    return str.replace(/'/g, "'\\''").replace(/[^a-zA-Z0-9._\-\/:@=]/g, (match) => {
      return `'${match.replace(/'/g, "'\\''")}'`;
    });
  });
  
  // Build the command string safely
  const commandString = [command, ...sanitizedArgs].join(' ');
  
  // Default options for security
  const defaultOptions = {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 300000,
    ...options
  };
  
  return new Promise((resolve, reject) => {
    exec(commandString, defaultOptions, (error, stdout, stderr) => {
      if (error) {
        error.message = `Command failed: ${commandString}\n${error.message}`;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
};

module.exports = {
  colors,
  createLogger,
  confirm,
  promptChoice,
  promptChoiceWithEdit,
  editScriptInEditor,
  fileSize,
  createLink,
  checkPath,
  sleep,
  processInstallSnippetReplacements,
  parseFlags,
  safeExecSync,
  safeExec,
};
