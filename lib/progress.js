const cliProgress = require("cli-progress");
const { colors } = require("./utils");

const createModuleProgress = () => {
  const modules = [];
  let currentModule = null;

  const startModule = (name, description = "") => {
    currentModule = {
      name,
      description,
      startTime: Date.now(),
      status: "running",
    };
    modules.push(currentModule);
    printModuleStatus(currentModule, "running");
  };

  const completeModule = (success = true, message = "") => {
    if (currentModule) {
      currentModule.status = success ? "done" : "failed";
      currentModule.endTime = Date.now();
      currentModule.message = message;
      printModuleStatus(currentModule, success ? "done" : "failed");
      currentModule = null;
    }
  };

  const printModuleStatus = (mod, status) => {
    const statusIcons = {
      running: `${colors.fg.yellow}⏳${colors.reset}`,
      done: `${colors.fg.green}✓${colors.reset}`,
      failed: `${colors.fg.red}✗${colors.reset}`,
    };

    const icon = statusIcons[status] || "•";
    const elapsed =
      mod.endTime && mod.startTime
        ? ` (${((mod.endTime - mod.startTime) / 1000).toFixed(1)}s)`
        : "";
    const desc = mod.description ? ` - ${mod.description}` : "";
    const msg = mod.message ? ` ${colors.dim}${mod.message}${colors.reset}` : "";

    process.stdout.write(`\r${icon} ${mod.name}${desc}${elapsed}${msg}\n`);
  };

  return { startModule, completeModule };
};

const createProgressBar = (options = {}) => {
  const {
    format = "{bar} {percentage}% | {value}/{total} | {eta}s remaining",
    barSize = 40,
  } = options;

  const bar = new cliProgress.SingleBar({
    format: `${colors.fg.cyan}${format}${colors.reset}`,
    barCompleteChar: "█",
    barIncompleteChar: "░",
    hideCursor: true,
    barsize: barSize,
    forceRedraw: true,
    fps: 10,
    etaBuffer: 10,
    etaAsynchronousUpdate: true,
  });

  return {
    start: (total, initial = 0, payload = {}) => {
      bar.start(total, initial, payload);
    },
    update: (value, payload = {}) => {
      bar.update(value, payload);
    },
    increment: (delta = 1, payload = {}) => {
      bar.increment(delta, payload);
    },
    stop: () => {
      bar.stop();
    },
  };
};

const createDownloadProgressBar = () => {
  const { fileSize } = require("./utils");

  const bar = new cliProgress.SingleBar({
    format:
      `${colors.fg.cyan}Downloading${colors.reset} |{bar}| {percentage}% | {downloaded}/{total} | {speed} | ETA: {eta}`,
    barCompleteChar: "█",
    barIncompleteChar: "░",
    hideCursor: true,
    barsize: 30,
    forceRedraw: true,
    fps: 10,
  });

  let startTime = Date.now();
  let lastUpdateTime = startTime;
  let lastReceivedBytes = 0;

  return {
    start: (totalSize) => {
      startTime = Date.now();
      lastUpdateTime = startTime;
      lastReceivedBytes = 0;
      bar.start(totalSize, 0, {
        downloaded: fileSize(0, true),
        total: fileSize(totalSize, true),
        speed: "0 B/s",
        eta: "calculating...",
      });
    },
    update: (receivedBytes, totalSize) => {
      const now = Date.now();
      const timeDiff = (now - lastUpdateTime) / 1000;

      if (timeDiff >= 0.1) {
        const speed = (receivedBytes - lastReceivedBytes) / timeDiff;
        const avgSpeed = receivedBytes / ((now - startTime) / 1000);
        const remainingBytes = totalSize - receivedBytes;
        const etaSeconds = avgSpeed > 0 ? remainingBytes / avgSpeed : 0;

        bar.update(receivedBytes, {
          downloaded: fileSize(receivedBytes, true),
          total: fileSize(totalSize, true),
          speed: `${fileSize(speed, true)}/s`,
          eta: formatEta(etaSeconds),
        });

        lastUpdateTime = now;
        lastReceivedBytes = receivedBytes;
      }
    },
    complete: (totalSize) => {
      bar.update(totalSize, {
        downloaded: fileSize(totalSize, true),
        total: fileSize(totalSize, true),
        speed: "done",
        eta: "✓",
      });
      bar.stop();
    },
    stop: () => {
      bar.stop();
    },
  };
};

const createInstallProgressBar = (label = "Installing") => {
  const bar = new cliProgress.SingleBar({
    format: `${colors.fg.cyan}${label}${colors.reset} |{bar}| {status}`,
    barCompleteChar: "█",
    barIncompleteChar: "░",
    hideCursor: true,
    barsize: 30,
    forceRedraw: true,
  });

  return {
    start: () => {
      bar.start(100, 0, { status: "Starting..." });
    },
    updateStatus: (percent, status) => {
      bar.update(percent, { status });
    },
    complete: (success = true) => {
      bar.update(100, { status: success ? "Complete ✓" : "Failed ✗" });
      bar.stop();
    },
    stop: () => {
      bar.stop();
    },
  };
};

const formatEta = (seconds) => {
  if (!isFinite(seconds) || seconds < 0) return "calculating...";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const createSpinner = (message) => {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let interval = null;

  return {
    start: () => {
      interval = setInterval(() => {
        process.stdout.write(
          `\r${colors.fg.cyan}${frames[frameIndex]}${colors.reset} ${message}`
        );
        frameIndex = (frameIndex + 1) % frames.length;
      }, 80);
    },
    stop: (finalMessage = "") => {
      if (interval) {
        clearInterval(interval);
        interval = null;
        process.stdout.write(
          `\r${colors.fg.green}✓${colors.reset} ${finalMessage || message}\n`
        );
      }
    },
    fail: (errorMessage = "") => {
      if (interval) {
        clearInterval(interval);
        interval = null;
        process.stdout.write(
          `\r${colors.fg.red}✗${colors.reset} ${errorMessage || message}\n`
        );
      }
    },
  };
};

const createMultiSelect = async (items, message = "Select items:") => {
  const readline = require("readline");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const selected = new Set();

  return new Promise((resolve) => {
    const render = () => {
      console.clear();
      console.log(`${colors.fg.cyan}${message}${colors.reset}`);
      console.log(`${colors.dim}(Use number to toggle, 'a' for all, 'd' for done, 'q' to quit)${colors.reset}\n`);

      items.forEach((item, index) => {
        const isSelected = selected.has(index);
        const checkbox = isSelected
          ? `${colors.fg.green}[✓]${colors.reset}`
          : `${colors.dim}[ ]${colors.reset}`;
        const label = typeof item === "string" ? item : item.label || item.name;
        console.log(`  ${index + 1}. ${checkbox} ${label}`);
      });

      console.log("");
    };

    const askQuestion = () => {
      render();
      rl.question("Enter choice: ", (input) => {
        const trimmed = input.trim().toLowerCase();

        if (trimmed === "q" || trimmed === "quit") {
          rl.close();
          resolve([]);
          return;
        }

        if (trimmed === "d" || trimmed === "done") {
          rl.close();
          resolve(items.filter((_, idx) => selected.has(idx)));
          return;
        }

        if (trimmed === "a" || trimmed === "all") {
          if (selected.size === items.length) {
            selected.clear();
          } else {
            items.forEach((_, idx) => selected.add(idx));
          }
          askQuestion();
          return;
        }

        const num = parseInt(trimmed);
        if (!isNaN(num) && num >= 1 && num <= items.length) {
          const idx = num - 1;
          if (selected.has(idx)) {
            selected.delete(idx);
          } else {
            selected.add(idx);
          }
        }

        askQuestion();
      });
    };

    askQuestion();
  });
};

module.exports = {
  createModuleProgress,
  createProgressBar,
  createDownloadProgressBar,
  createInstallProgressBar,
  createSpinner,
  createMultiSelect,
  formatEta,
};
