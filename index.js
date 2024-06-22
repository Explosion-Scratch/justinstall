const readline = require("readline");
const { execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

let tmpdir;
async function main() {
  const args = process.argv.slice(2);
  let isFile = fs.existsSync(args[0]);
  let filepath = isFile ? path.resolve(args[0]) : null;

  if (isFile) {
    console.log("Installing " + filepath + " from local files");
  }

  // Declare some stuff
  tmpdir = execSync("mktemp -d").toString().trim();
  let selected;

  // OS detection stuff:
  const arch = process.arch;
  const platform = process.platform;
  console.log(`Detected ${arch} on ${platform}`);
  let arch_aliases = {
    arm64: ["arm64", "arm", "aarch", "aarh64"],
    x64: ["x64", "intel"],
    universal: ["universal", "all"],
  };
  let platform_aliases = {
    darwin: ["darwin", "osx", "mac", "apple"],
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
    deb: process.platform === "linux" && ebool("which apt").length > 0,
    dmg: process.platform === "darwin",
    app: process.platform === "darwin",
    rpm: ebool("which dnf").length > 0,
    "tar.zst": ebool("which pacman").length > 0,
  };

  const possible = {
    platforms: Object.values(platform_aliases).flat(),
    arches: Object.values(arch_aliases).flat(),
  };

  const IGNORE = [
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
  ];
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
      .then((assets) => {
        return assets.filter(
          (asset) => !IGNORE.find((i) => asset.name.includes(i))
        );
      });

    assets = assets.map((i) => ({ ...i, segments: i.name.split(/[_ \.\-]/) }));
    assets = assets.map((i) => ({
      ...i,
      compatiblePlatforms: i.segments.filter((j) =>
        possible.platforms.includes(j)
      ),
      compatibleArches: i.segments.filter((j) => possible.arches.includes(j)),
      extension: getExtension(i.name),
    }));

    let code = getCode(body)?.trim();
    const isInstaller = (code) =>
      code.includes("| sh") ||
      code.includes("| bash") ||
      code.includes("curl ") ||
      code.includes("wget ") ||
      code.includes("installer.sh") ||
      code.includes(".sh");

    if (code && isInstaller(code)) {
      console.log("Found installer code in release notes:\n\n" + code + "\n\n");
      if (
        await confirm(
          "Run install script (y) or continue to regular installation (n)?"
        )
      ) {
        console.log("Running...");
        execSync(code);
        return;
      }
    }
    let installerScript = assets.find((i) => i.name.includes("installer.sh"));
    if (installerScript) {
      console.log(`Found installer script: ${installerScript.name}`);
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
      return console.log(
        "Couldn't find a binary, you'll have to figure it out yourself 🤷:\n" +
          `https://github.com/${owner}/${repo}`
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
    return console.log("Couldn't find anything to install");
  }
  const shouldInstall = await confirm(
    `Ok to install ${selected.name} (${fileSize(selected.size)})?`
  );
  if (!shouldInstall) {
    return console.log("Aborted install");
  }
  process.chdir(tmpdir);
  console.log(`Downloading ${selected.name}`);

  const checkPath = async (p) => {
    if (fs.existsSync(path.resolve(p))) {
      if (!(await confirm(`Overwrite ${p}?`))) {
        throw new Error("Aborted overwrite of file " + p);
      }
    }
  };
  const getPath = (filename) => path.join(tmpdir, filename);
  const getName = (sel) =>
    sel.name
      .replace(sel.extension, "")
      .replace(
        new RegExp(
          `(?:${[...possible.platforms, ...possible.arches].join("|")})`,
          "gi"
        ),
        ""
      )
      .replace(/v?[0-9]+\.[0-9]+\.[0-9]+/i, "")
      .replace(/[ _\-\.]+$/, "")
      .replace(/^[ _\-\.]+/, "");
  const mountDMG = (p) => {
    console.log("Mounting DMG", p);
    execSync(
      `hdiutil attach ${JSON.stringify(
        p
      )} -nobrowse -mountpoint ${JSON.stringify(OUTPUT_DIR)}`
    );
  };
  const installPkg = (p) => {
    console.log("Installing pkg...");
    execSync(`sudo installer -pkg ${JSON.stringify(p)} -target /`);
    console.log(`Installed pkg ${path.basename(p)} to /`);
  };
  const newpath = path.resolve(tmpdir, path.basename(filepath));
  fs.cpSync(filepath, newpath);
  const p = newpath || getPath(selected.name);
  if (!isFile) {
    await fetch(selected.browser_download_url)
      .then((r) => r.arrayBuffer())
      .then((a) => (console.log(`Downloaded, writing to ${p}`), a))
      .then((b) => fs.writeFileSync(p, Buffer.from(b)));
  }

  console.log(`Preinstall: ${selected.name}`);
  const OUTPUT_DIR = path.join(tmpdir, "outputs");
  fs.mkdirSync(OUTPUT_DIR);

  let isBinary = true;
  if (selected.extension === "tar.gz") {
    console.log("Unzipping TAR");
    execSync(
      `tar -xzf ${JSON.stringify(p)} --directory ${JSON.stringify(OUTPUT_DIR)}`
    );
  } else if (selected.extension === "pkg") {
    installPkg(p);
  } else if (selected.extension === "zip") {
    console.log("Unzipping ZIP");
    execSync(`unzip ${JSON.stringify(p)} -d ${JSON.stringify(OUTPUT_DIR)}`);
  } else if (selected.extension === "dmg") {
    isBinary = false;
    console.log("Mounting DMG");
    mountDMG(p);
  } else if (selected.extension === "deb") {
    isBinary = false;
  } else if (!selected.extension) {
    console.log("Already a binary");
    fs.renameSync(p, path.join(OUTPUT_DIR, selected.name));
  }
  let binaries = fs.readdirSync(OUTPUT_DIR).filter((i) => !IGNORE.includes(i));
  const _dmg = binaries.find((f) => f.endsWith(".dmg"));
  if (_dmg) {
    isBinary = false;
    mountDMG(path.resolve(OUTPUT_DIR, _dmg));
  }
  // Do after possible DMG mounted
  binaries = fs.readdirSync(OUTPUT_DIR).filter((i) => !IGNORE.includes(i));
  const _app = binaries.find((f) => f.endsWith(".app"));
  const _pkg = binaries.find((f) => f.endsWith(".pkg"));
  if (
    !(await confirm(
      `Continue installation of ${
        binaries.length ? binaries.join(",") : selected.name
      }?`
    ))
  ) {
    return console.log("Aborted");
  }
  const installApp = async (_app) => {
    if (!canInstall.app) {
      return console.log("Cannot install .app package");
    }
    console.log("Found mac .app package, installing...");
    const dest = path.join("/Applications", _app);
    await checkPath(dest);
    fs.cpSync(path.join(OUTPUT_DIR, _app), dest, {
      recursive: true,
    });
    console.log("Code signing app...");
    try {
      execSync(`codesign --sign - --force --deep ${JSON.stringify(dest)}`);
    } catch (e) {
      console.log("Codesigning failed");
    }
    console.log("Removing quarantine from app...");
    try {
      execSync(`xattr -rd com.apple.quarantine ${JSON.stringify(dest)}`);
    } catch (e) {
      console.log("Dequarantining failed");
    }
    try {
      execSync(`hdiutil eject ${JSON.stringify(OUTPUT_DIR)} 2> /dev/null`, {
        stdio: false,
      });
    } catch (e) {}
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
      return console.log("No binaries found");
    }
    console.log("Got binaries: ", binaries.join("\n"));
    console.log("Renaming binaries...");
    for (const bin of binaries) {
      fs.renameSync(
        path.join(OUTPUT_DIR, bin),
        path.join(OUTPUT_DIR, getName(selected))
      );
    }
  }
  if (isBinary) {
    console.log("Installing binary");
    for (let bin of fs.readdirSync(OUTPUT_DIR)) {
      const dest = path.join(os.homedir(), ".local", "bin", bin);
      await checkPath(dest);
      console.log(`Installing binary: "${bin}" -> "${dest}"`);
      execSync(`chmod +x ${JSON.stringify(path.join(OUTPUT_DIR, bin))}`);
      fs.cpSync(path.join(OUTPUT_DIR, bin), dest);
    }
  } else if (selected.extension === "deb") {
    console.log("Installing DEB");
    execSync(`dpkg -i ${JSON.stringify(p)} ${JSON.stringify(OUTPUT_DIR)}`);
  }
  console.log("Done:", binaries.join("\n"));
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
    interface.question(`${question} (${defaultAnswer}/n) `, (ans) => {
      let result =
        ans.trim().toLowerCase() === "y" || ans.trim().toLowerCase() === "yes";
      if (defaultAnswer === "y" && ans.trim() === "") result = true;
      interface.close();
      resolve(result);
    });
  });
}

(async () => {
  try {
    await main();
  } catch (e) {
    console.log("Error: " + e.stack);
  }
  if (tmpdir) {
    console.log("Cleaning up...");
    fs.rmSync(tmpdir, { recursive: true });
    console.log("Done");
  }
})();
