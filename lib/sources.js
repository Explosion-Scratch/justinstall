const fs = require("fs");
const path = require("path");

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

const parseSource = (input) => {
  const isFile = fs.existsSync(input);
  const isURL =
    /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/.test(
      input
    );

  if (isFile) {
    return {
      type: "file",
      url: path.resolve(input),
      originalArgs: [input],
    };
  }

  if (isURL) {
    if (input.includes("github.com")) {
      const [owner, repo] = input
        .replace(/(?:https?:\/\/)?github\.com\//, "")
        .split("/");
      return {
        type: "github",
        url: input,
        owner,
        repo,
        originalArgs: [input],
      };
    }
    return {
      type: "url",
      url: input,
      originalArgs: [input],
    };
  }

  // Assume it's a shorthand GitHub repo
  if (/^[a-z_\-0-9]+\/[a-z_\-0-9]+$/.test(input)) {
    const [owner, repo] = input.split("/");
    return {
      type: "github",
      url: `https://github.com/${input}`,
      owner,
      repo,
      originalArgs: [input],
    };
  }

  throw new Error(`Invalid source: ${input}`);
};

const getGitHubAssets = async (owner, repo) => {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/latest`
  );
  const release = await response.json();

  if (!release.assets) {
    throw new Error("No assets found in GitHub release");
  }

  const assets = release.assets
    .filter((asset) => !isIgnored(asset.name))
    .map((asset) => ({
      ...asset,
      segments: asset.name.split(/[_ \.\-]/).map((s) => s.toLowerCase()),
      extension: getExtension(asset.name),
    }));

  return {
    assets,
    body: release.body,
    tag: release.tag_name,
    commit: release.target_commitish,
  };
};

const downloadFromUrl = async (url, destPath) => {
  const response = await fetch(url, {
    headers: {
      ...(getOrigin(url) && { origin: getOrigin(url) }),
    },
    referrer: getOrigin(url) || url,
  });

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buffer));

  const disposition = response.headers.get("Content-Disposition");
  const filenameRegex = /filename="?([^;"]+)"/;
  const match = disposition && disposition.match(filenameRegex);
  const filename = match?.[1] || url.substring(url.lastIndexOf("/") + 1);

  return { filename, size: buffer.byteLength };
};

const getOrigin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const getExtension = (filename) => {
  const parts = filename.split(".");
  if (parts.length === 1) return "";
  if (parts.length > 2 && parts.slice(-2).join(".") === "tar.gz") {
    return "tar.gz";
  }
  return parts.pop();
};

const getCodeFromMarkdown = (markdown) => {
  const regex = /```(?:\w*\n)?([\s\S]*?)```/g;
  let match;
  let codeBlocks = "";

  while ((match = regex.exec(markdown)) !== null) {
    codeBlocks += match[1] + "\n";
  }

  return codeBlocks;
};

const isInstaller = (code) => {
  if (!code) return false;

  code = code.toLowerCase().trim();
  if (code.split("\n").length > 3) return false;

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

const findInstallScript = async (owner, repo, body) => {
  // Check release body first
  const releaseCode = getCodeFromMarkdown(body)?.trim();
  if (releaseCode && isInstaller(releaseCode)) {
    return { code: releaseCode, source: "release" };
  }

  // Check README
  try {
    const readme = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`
    ).then((r) => r.text());

    const codeBlockRegex =
      /(?:(?:```(?<lang>\w*)?\n(?<code>[\s\S]*?)```)|(?:\s+\n(?:\t| +)(?<code2>[\s\S]*?)\n))/;
    const codeBlocks = readme
      .match(new RegExp(codeBlockRegex, "g"))
      ?.filter(Boolean)
      .map(
        (code) =>
          code?.match(codeBlockRegex)?.groups?.code ||
          code?.match(codeBlockRegex)?.groups?.code2
      )
      .map((i) => i?.trim())
      .filter(Boolean)
      .filter(isInstaller);

    if (codeBlocks?.length) {
      return { code: codeBlocks[0], source: "readme" };
    }
  } catch (e) {
    // Ignore README fetch errors
  }

  return null;
};

module.exports = {
  parseSource,
  getGitHubAssets,
  downloadFromUrl,
  getExtension,
  findInstallScript,
  isIgnored,
};
