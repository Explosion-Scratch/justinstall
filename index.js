const readline = require("readline");
const { execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

let tmpdir;

const OSC = "\u001B]";
const SEP = ";";
const BEL = "\u0007";
const link = (text, url) =>
  [OSC, "8", SEP, SEP, url, BEL, text, OSC, "8", SEP, SEP, BEL].join("");

const HELP = `justinstall <github-url|file-url|local-file>\n\tv1.0.0 - Just install anything. Supports .tar.gz, .zip, .dmg, .app, .pkg, and .deb files. Binaries will be installed to ~/.local/bin.\n\n\tExample:\n\t\tjustinstall atuinsh/atuin\n\t\tjustinstall https://github.com/junegunn/fzf/\n\t\tjustinstall https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg\n\t\tjustinstall tailscale.pkg\n\n\tMade by ${link(
  "Explosion-Scratch",
  "https://github.com/explosion-scratch"
)}`;
async function main() {
  const INSTALL_SNIPPET_REPLACEMENTS = [
    [/^\$ +/, ""],
    ["npm install", "pnpm i"],
    ["yarn install", "pnpm i"],
  ];
  const log = {
    debug: (message) =>
      console.log(`${colors.fg.cyan}${message}${colors.reset}`),
    log: (message) =>
      console.log(`${colors.fg.white}${message}${colors.reset}`),
    error: (message) =>
      console.error(`${colors.fg.red}${message}${colors.reset}`),
    warn: (message) =>
      console.warn(`${colors.fg.yellow}${message}${colors.reset}`),
  };

  let args = process.argv.slice(2);
  if (["-h", "--help"].includes(args[0])) {
    return log.log(HELP);
  }
  if (!args[0]) {
    return log.log(HELP);
  }
  let isFile = fs.existsSync(args[0]);
  let isURL =
    /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/.test(
      args[0]
    );
  if (!isFile && !isURL && /^[a-z_\-0-9]+\/[a-z_\-0-9]+$/.test(args[0])) {
    args[0] = `https://github.com/${args[0]}`;
  }
  let filepath = isFile ? path.resolve(args[0]) : null;

  if (isFile) {
    log.debug("Installing " + filepath + " from local files");
  }

  // Declare some stuff
  tmpdir = execSync("mktemp -d").toString().trim();

  if (isURL && !args[0].includes("://github.com")) {
    log.debug("Downloading file from URL...");
    let origin;
    try {
      origin = new URL(args[0]).origin;
    } catch (e) {}
    let response = await fetch(args[0], {
      headers: {
        ...(origin && { origin }),
      },
      referrer: `https://${origin}` || args[0],
    });
    const disposition = response.headers.get("Content-Disposition");
    const filenameRegex = /filename="?([^;"]+)"/;
    const match = disposition && disposition.match(filenameRegex);
    let filename =
      match?.[1] || args[0].substring(args[0].lastIndexOf("/") + 1);
    const dest = path.join(tmpdir, filename);
    await response
      .arrayBuffer()
      .then((ab) => fs.writeFileSync(dest, Buffer.from(ab)));
    log.debug("Downloaded " + filename);
    isFile = true;
    filepath = dest;
  }

  let selected;

  // OS detection stuff:
  const arch = process.arch;
  const platform = process.platform;
  log.debug(`Detected ${arch} on ${platform}`);
  let arch_aliases = {
    arm64: ["arm64", "arm", "aarch", "aarh64"],
    x64: ["x64", "intel"],
    universal: ["universal", "all"],
  };
  let boosters = {
    darwin: ["pkg", "dmg"],
    linux: ["AppImage"],
  };
  let platform_aliases = {
    darwin: ["darwin", "osx", "macos", "mac", "apple"],
    linux: ["linux"],
    freebsd: ["freebsd", "linux"],
    openbsd: ["openbsd", "linux"],
    win32: ["win32", "win", "windows"],
    universal: arch_aliases.universal,
  };
  const my_arch = [
    arch,
    ...(platform === "darwin" ? ["m1", "m2", "m3"] : []),
    ...(arch_aliases[arch] || arch_aliases.universal),
  ];
  const my_platform = [
    platform,
    ...(platform_aliases[platform] || platform_aliases.universal),
  ];

  const incl = (a, b) => a.find((i) => b.includes(i));
  const ebool = (cmd) => {
    try {
      return execSync(cmd, { stdio: "ignore" }).length > 0;
    } catch (e) {
      return false;
    }
  };

  let canInstall = {
    // Regular linux
    deb: process.platform === "linux" && ebool("which apt").length > 0,

    // Mac
    dmg: process.platform === "darwin",
    pkg: process.platform === "darwin",
    app: process.platform === "darwin",

    // Arch linux
    rpm: ebool("which dnf").length > 0,
    "tar.zst": ebool("which pacman").length > 0,
  };

  const possible = {
    platforms: Object.values(platform_aliases).flat(),
    arches: Object.values(arch_aliases).flat(),
  };

  const IGNORE = [
    "Applications",
    "checksums",
    "release_notes",
    "readme",
    "license",
    ".txt",
    "__MACOSX",
    ".background",
    ".keystone_install",
    ".VolumeIcon.icns",
    ".DS_Store",
    "CHANGELOG",
    "LICENSE",
  ];

  const isIgnored = (filename) => {
    return IGNORE.find((p) => filename.toLowerCase().includes(p.toLowerCase()));
  };

  if (!isFile) {
    const [owner, repo] = args[0]
      .replace(/(?:https?\:\/\/)?github\.com\//, "")
      .split("/");

    let body;
    let assets = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`
    )
      .then((r) => r.json())
      .then((a) => ((body = a.body), a))
      .then((j) => j.assets)
      .then((a) => (log.debug("Found " + a.length + " assets"), a))
      .then((assets) => {
        return assets.filter((asset) => !isIgnored(asset.name));
      });

    assets = assets.map((i) => ({
      ...i,
      segments: i.name.split(/[_ \.\-]/).map((j) => j.toLowerCase()),
    }));
    assets = assets.map((i) => ({
      ...i,
      compatiblePlatforms: i.segments.filter((j) =>
        possible.platforms.includes(j)
      ),
      compatibleArches: i.segments.filter((j) => possible.arches.includes(j)),
      extension: getExtension(i.name),
    }));

    let code = getCode(body)?.trim();
    const isInstaller = (code) => {
      if (!code){return false}
      code = code.toLowerCase().trim();
      // Looking for a one-to-three-liner e.g. pnpm i -g thing or sudo apt install package
      if (code.split("\n").length > 3){return false}
      if (
        code.includes("installing") ||
        code.includes("](#") ||
        code.includes("](http") ||
        code.startsWith("- [")
      ) {
        return false;
      }
      return (
        code.includes("| sh") ||
        code.includes("| bash") ||
        code.includes("curl ") ||
        code.includes("wget ") ||
        code.includes("install") ||
        code.includes("setup") ||
        code.includes("installer.sh") ||
        code.includes(".sh") ||
        code.includes("sudo emerge")
      );
    };

    if (code && isInstaller(code)) {
      log.debug(
        "Found installer code in release notes:\n\n\t" +
          colors.fg.green +
          code +
          colors.reset +
          "\n"
      );
      if (
        await confirm(
          "Run install script (y) or continue to regular installation (n)?"
        )
      ) {
        log.debug("Running...");
        execSync(code);
        return;
      }
    } else {
      // Assuming branch is main - yikes
      const readme = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`
      ).then((r) => r.text());
      const re =
        /(?:(?:```(?<lang>\w*)?\n(?<code>[\s\S]*?)```)|(?:\s+\n(?:\t| +)(?<code2>[\s\S]*?)\n))/;
      const codeBlocks = readme
        .match(new RegExp(re, "g"))
        ?.filter(Boolean)
        .map(
          (code) =>
            code?.match(re)?.groups?.code || code?.match(re)?.groups?.code2
        )
        .map((i) => i?.trim())
        .filter(Boolean)
        .filter(isInstaller);
      if (codeBlocks?.length) {
        let b = codeBlocks[0].trim();
        for (let [k, v] of INSTALL_SNIPPET_REPLACEMENTS) {
          b = b.replace(k, v);
        }
        log.log(
          `Found possible install snippet in README:\n\n\t${colors.fg.green}${b}${colors.reset}\n`
        );
        if (
          await confirm(
            "Run script in shell (y) or proceed to normal installation (n)?",
            "n"
          )
        ) {
          log.debug("Running script...");
          execSync(b);
          log.debug("Done installing");
          return;
        } else {
          log.debug("Continuing to regular installation.");
        }
      }
    }
    if (!assets?.length) {
      throw new Error("No assets in releases");
    }
    let installerScript = assets.find((i) => i.name.includes("installer.sh"));
    if (installerScript) {
      log.debug(`Found installer script: ${installerScript.name}`);
      await fetch(installerScript.browser_download_url)
        .then((r) => r.arrayBuffer())
        .then((ab) =>
          fs.writeFileSync(path.join(tmpdir, "installer.sh"), Buffer.from(ab))
        );
      execSync(`chmod +x ${JSON.stringify(path.join(tmpdir, "installer.sh"))}`);
      if (await confirm(`Run install script? ${tmpdir}/installer.sh`)) {
        execSync(`${tmpdir}/installer.sh`);
        return;
      }
      // Continue to regular installation
    }
    let compat = assets
      .map((asset) => {
        asset.points = 0;
        if (boosters[platform]) {
          for (let i of boosters[platform]) {
            if (asset.name.includes(i)) {
              asset.points += 0.1;
            }
          }
        }
        if (asset.compatiblePlatforms.length) {
          if (incl(asset.compatiblePlatforms, my_platform)) {
            asset.points += 1;
          } else {
            asset.delete = true;
          }
        }
        if (asset.compatibleArches.length) {
          if (incl(asset.compatibleArches, my_arch)) {
            asset.points += 1;
          } else {
            asset.delete = true;
          }
        }
        if (canInstall[asset.extension] === false) {
          asset.delete = true;
        }
        if (asset.segments.includes("pkgbuild") && !canInstall["tar.zst"]) {
          asset.delete = true;
        }
        return asset;
      })
      .filter((i) => !(i.delete == true))
      .sort((a, b) => b.points - a.points);
    if (!compat?.length) {
      return log.error(
        "Couldn't find a binary, you'll have to figure it out yourself 🤷:\n" +
          `${colors.fg.green}https://github.com/${owner}/${repo}${colors.reset}`
      );
    }
    selected = compat[0];
  } else {
    selected = {
      name: path.basename(filepath),
      size: fs.statSync(filepath).size,
      extension: getExtension(path.basename(filepath)),
    };
  }
  if (!selected) {
    return log.error("Couldn't find anything to install");
  }
  const shouldInstall = await confirm(
    `Ok to install ${selected.name} (${fileSize(selected.size)})?`
  );
  if (!shouldInstall) {
    return log.error("Aborted install");
  }
  process.chdir(tmpdir);
  log.debug(`Downloading ${selected.name}`);

  const checkPath = async (p) => {
    if (fs.existsSync(path.resolve(p))) {
      if (!(await confirm(`Overwrite ${p}?`))) {
        throw new Error("Aborted overwrite of file " + p);
      } else {
        try {
          log.debug("Removing " + p);
          fs.rmSync(p, { recursive: true, force: true });
        } catch (e) {}
      }
    }
  };
  const getPath = (filename) => path.join(tmpdir, filename);
  const getName = (sel) =>
    sel.name
      .replace(sel.extension, "")
      .replace(/v?[0-9]+\.[0-9]+\.[0-9]+/i, "")
      .replace(
        new RegExp(
          `(?:${[...possible.platforms, ...possible.arches].join("|")})`,
          "gi"
        ),
        ""
      )
      .replace(/[ _\-\.]+$/, "")
      .replace(/^[ _\-\.]+/, "");
  const mountDMG = (p) => {
    log.debug("Mounting DMG", p);
    execSync(
      `hdiutil attach ${JSON.stringify(
        p
      )} -nobrowse -mountpoint ${JSON.stringify(OUTPUT_DIR)}`
    );
  };
  const installPkg = (p) => {
    if (!canInstall.pkg) {
      throw new Error("Can't install .pkg files in this environment");
    }
    log.debug("Installing pkg...");
    execSync(`sudo installer -pkg ${JSON.stringify(p)} -target /`);
    log.debug(`Installed pkg ${path.basename(p)} to /`);
  };
  let newpath;
  if (isFile) {
    newpath = path.resolve(tmpdir, path.basename(filepath));
    if (filepath !== newpath) {
      fs.cpSync(filepath, newpath);
    }
  }
  const p = newpath || getPath(selected.name);
  if (!isFile) {
    await fetch(selected.browser_download_url)
      .then((r) => r.arrayBuffer())
      .then((a) => (log.debug(`Downloaded, writing to ${p}`), a))
      .then((b) => fs.writeFileSync(p, Buffer.from(b)));
  }

  log.log(`Preinstall: ${selected.name}`);
  const OUTPUT_DIR = path.join(tmpdir, "outputs");
  fs.mkdirSync(OUTPUT_DIR);

  let isBinary = true;
  if (selected.extension === "tar.gz") {
    log.debug("Unzipping TAR");
    execSync(
      `tar -xzf ${JSON.stringify(p)} --directory ${JSON.stringify(OUTPUT_DIR)}`
    );
  } else if (selected.extension === "pkg") {
    installPkg(p);
  } else if (selected.extension === "zip") {
    log.debug("Unzipping ZIP");
    execSync(`unzip ${JSON.stringify(p)} -d ${JSON.stringify(OUTPUT_DIR)}`);
  } else if (selected.extension === "dmg") {
    isBinary = false;
    mountDMG(p);
  } else if (selected.extension === "deb") {
    isBinary = false;
  } else if (!selected.extension) {
    fs.renameSync(p, path.join(OUTPUT_DIR, selected.name));
  }
  let binaries = fs.readdirSync(OUTPUT_DIR).filter((i) => !isIgnored(i));
  const _dmg = binaries.find((f) => f.endsWith(".dmg"));
  if (_dmg) {
    isBinary = false;
    mountDMG(path.resolve(OUTPUT_DIR, _dmg));
  }
  // Do after possible DMG mounted
  binaries = fs.readdirSync(OUTPUT_DIR).filter((i) => !isIgnored(i));
  const _app = binaries.find((f) => f.endsWith(".app"));
  const _pkg = binaries.find((f) => f.endsWith(".pkg"));
  if (
    !(await confirm(
      `Continue installation of ${
        binaries.length ? binaries.join(",") : selected.name
      }?`
    ))
  ) {
    return log.error("Aborted");
  }
  const installApp = async (_app) => {
    if (!canInstall.app) {
      return log.error("Cannot install .app package");
    }
    log.debug("Found mac .app package, installing...");
    const dest = path.join("/Applications", _app);
    await checkPath(dest);
    log.debug("Writing files...");
    fs.cpSync(path.join(OUTPUT_DIR, _app), dest, {
      recursive: true,
    });
    log.debug("Code signing app...");
    try {
      execSync(
        `codesign --sign - --force --deep ${JSON.stringify(dest)} 2> /dev/null`
      );
    } catch (e) {
      log.warn("Codesigning failed");
    }
    log.debug("Removing quarantine from app...");
    try {
      execSync(
        `xattr -rd com.apple.quarantine ${JSON.stringify(dest)} 2> /dev/null`
      );
    } catch (e) {
      log.warn("Dequarantining failed");
    }
    try {
      execSync(`hdiutil eject ${JSON.stringify(OUTPUT_DIR)} 2> /dev/null`, {
        stdio: false,
      });
    } catch (e) {}
    execSync("sleep 0.5");
    if (await confirm("Open app " + path.basename(dest))) {
      execSync(`open -n ${JSON.stringify(dest)}`);
    }
  };

  if (_app) {
    isBinary = false;
    await installApp(_app);
    return;
  }
  if (_pkg) {
    isBinary = false;
    installPkg(path.resolve(OUTPUT_DIR, _pkg));
    return;
  }

  if (isBinary) {
    if (!binaries.length) {
      return log.error("No binaries found");
    }
    log.debug("Got binaries: ", binaries.join("\n"));
    log.debug("Renaming binaries...");
    for (const bin of binaries) {
      fs.renameSync(
        path.join(OUTPUT_DIR, bin),
        path.join(OUTPUT_DIR, getName(selected))
      );
    }
  }
  if (isBinary) {
    log.debug("Installing binary");
    for (let bin of fs.readdirSync(OUTPUT_DIR).filter((i) => !isIgnored(i))) {
      const dest = path.join(os.homedir(), ".local", "bin", bin);
      await checkPath(dest);
      log.debug(`Installing binary: "${bin}" -> "${dest}"`);
      execSync(`chmod +x ${JSON.stringify(path.join(OUTPUT_DIR, bin))}`);
      fs.cpSync(path.join(OUTPUT_DIR, bin), dest);
    }
  } else if (selected.extension === "deb") {
    log.debug("Installing DEB");
    execSync(`dpkg -i ${JSON.stringify(p)} ${JSON.stringify(OUTPUT_DIR)}`);
  }
  log.log("Done:", binaries.join("\n"));
}

function fileSize(bytes, si = false, dp = 1) {
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
}
function getExtension(filename) {
  const a = () => {
    let s = filename.split(".");
    if (s.length === 1) {
      return "";
    }
    if (s.length > 2) {
      return s.slice(-2).join(".");
    }
    return s.slice(-1)[0];
  };
  // Ends of versions
  let out = a()
    .split(".")
    .filter((i) => !parseInt(i, 10))
    .join(".");

  if (!["tar.gz"].includes(out)) {
    return out.split(".").slice(-1)[0];
  }
  return out;
}

function getCode(markdown) {
  // ```(?:\w*\n)?([\s\S]*?)```
  const regex = /```(?:\w*\n)?([\s\S]*?)```/g;
  let match;
  let codeBlocks = "";

  while ((match = regex.exec(markdown)) !== null) {
    codeBlocks += match[1] + "\n";
  }

  return codeBlocks;
}

function confirm(question, defaultAnswer = "y") {
  return new Promise((resolve) => {
    const interface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    interface.question(
      `${colors.fg.yellow}${question}${colors.reset} ${colors.fg.blue}(${
        defaultAnswer.toLowerCase() == "y" ? "Y" : "y"
      }/${defaultAnswer.toLowerCase() == "n" ? "N" : "n"})${colors.reset} `,
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
}

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
    crimson: "\x1b[38m", // Scarlet
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

const cleanup = () => {
  if (tmpdir) {
    console.log("Cleaning up...");
    fs.rmSync(tmpdir, { recursive: true });
    console.log("Done");
  }
};
(async () => {
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  try {
    await main();
  } catch (e) {
    console.log("Error: " + e.stack);
  }

  cleanup();
})();
