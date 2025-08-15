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
        .replace(/(?:https?:\/\/)?github\.com\//i, "")
        .split("/");
      return {
        type: "github",
        url: input,
        owner,
        repo,
        originalArgs: [input],
      };
    }

    // For all other URLs, try downloading first and fall back to scraping
    return {
      type: "smart_url",
      url: input,
      originalArgs: [input],
    };
  }

  // Assume it's a shorthand GitHub repo
  if (/^[a-z_\-0-9]+\/[a-z_\-0-9]+$/i.test(input)) {
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

const INSTALLABLE_EXTENSIONS = [
  "pkg",
  "dmg",
  "app",
  "deb",
  "rpm",
  "tar.gz",
  "zip",
  "tar.zst",
  "AppImage",
  "exe",
  "msi",
  "tar.bz2",
  "tar.xz",
  "7z",
];

const processAssetFromLink = (href, baseUrl, linkText) => {
  try {
    // Skip obviously non-downloadable links
    if (
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("#") ||
      href === "/" ||
      href === ""
    ) {
      return null;
    }

    const url = new URL(href, baseUrl);

    // Skip external links to known non-software sites
    const hostname = url.hostname.toLowerCase();
    if (
      hostname.includes("twitter.com") ||
      hostname.includes("facebook.com") ||
      hostname.includes("linkedin.com") ||
      hostname.includes("youtube.com")
    ) {
      return null;
    }

    const filename = decodeURIComponent(path.basename(url.pathname));

    if (!filename || filename === "/" || filename.length < 2) {
      return null;
    }

    const extension = getExtension(filename);

    // Check if it has an installable extension or could be an executable
    const hasInstallableExtension = INSTALLABLE_EXTENSIONS.includes(extension);
    const couldBeExecutable =
      !extension && !filename.includes(".") && filename.length > 2;

    if (!hasInstallableExtension && !couldBeExecutable) {
      return null;
    }

    // If ignored, skip
    if (isIgnored(filename)) {
      return null;
    }

    // Clean up link text for better asset names
    const cleanLinkText = linkText.replace(/<[^>]*>/g, "").trim();

    return {
      name: filename,
      browser_download_url: url.href,
      segments: filename.split(/[_ \.\-]/).map((s) => s.toLowerCase()),
      extension: extension,
      size: null, // We don't know the size yet
      linkText: cleanLinkText,
    };
  } catch (error) {
    return null;
  }
};

const isHtmlResponse = (response, content) => {
  const contentType = response.headers.get("content-type") || "";

  // Check content type first
  if (contentType.includes("text/html")) {
    return true;
  }

  // If no clear content type, check if content looks like HTML
  if (typeof content === "string") {
    const trimmed = content.trim().toLowerCase();
    return (
      trimmed.startsWith("<!doctype html") ||
      trimmed.startsWith("<html") ||
      (trimmed.includes("<head>") && trimmed.includes("<body>"))
    );
  }

  return false;
};

const trySmartDownload = async (url, log) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; justinstall/1.1.0)",
      Accept: "*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.statusText}`);
  }

  // Get first chunk to check if it's HTML
  const reader = response.body.getReader();
  const { value: firstChunk } = await reader.read();

  let content = new TextDecoder().decode(firstChunk);

  // Check if this is HTML content
  if (isHtmlResponse(response, content)) {
    log.debug("URL returned HTML content, scraping for download links...");

    // Read the rest of the response
    const chunks = [firstChunk];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const fullContent = new TextDecoder().decode(Buffer.concat(chunks));
    return await scrapeHtmlForAssets(url, fullContent);
  } else {
    log.debug("URL appears to be a direct download");

    // It's a binary file, reconstruct the response for download
    const allChunks = [firstChunk];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      allChunks.push(value);
    }

    const fullBuffer = Buffer.concat(allChunks);
    const contentDisposition = response.headers.get("Content-Disposition");
    const filenameRegex = /filename="?([^;"]+)"/;
    const match = contentDisposition && contentDisposition.match(filenameRegex);
    const filename =
      match?.[1] || new URL(url).pathname.split("/").pop() || "download";

    return {
      type: "direct_download",
      filename,
      buffer: fullBuffer,
      size: fullBuffer.length,
      url,
    };
  }
};

const scrapeHtmlForAssets = async (url, html) => {
  function allLinks(html, cb) {
    const re =
      /<a\b(?:(?:"[^"]*"|'[^']*'|[^"'<>])*)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))(?:(?:"[^"]*"|'[^']*'|[^"'<>])*)>(.*?)<\/a\s*>/gis;

    let match;
    while ((match = re.exec(html)) !== null) {
      const href = match[1] ?? match[2] ?? match[3] ?? "";
      const linkText = match[4]
        .replace(/<[^>]+>/g, "") // strip any nested tags
        .trim();
      cb(href, linkText);
    }
  }

  const assets = [];

  allLinks(html, (href, linkText) => {
    // Process asset with the current page URL as base, not just origin
    const asset = processAssetFromLink(href, url, linkText);

    if (asset) {
      assets.push(asset);
    }
  });

  // Remove duplicates based on URL
  const uniqueAssets = assets.filter(
    (asset, index, array) =>
      array.findIndex(
        (a) => a.browser_download_url === asset.browser_download_url
      ) === index
  );

  if (uniqueAssets.length === 0) {
    throw new Error("No installable assets found on website");
  }

  return {
    type: "scraped_assets",
    assets: uniqueAssets,
    body: `Found ${uniqueAssets.length} downloadable assets from ${url}`,
    tag: null,
    commit: null,
  };
};

const getWebsiteAssets = async (url) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; justinstall/1.1.0)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch website: ${response.statusText}`);
  }

  const html = await response.text();
  return await scrapeHtmlForAssets(url, html);
};

const downloadFromUrl = async (url, destPath, logger = null) => {
  const cliProgress = require("cli-progress");
  const { fileSize } = require("./utils");

  const response = await fetch(url, {
    headers: {
      ...(getOrigin(url) && { origin: getOrigin(url) }),
    },
    referrer: getOrigin(url) || url,
  });

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }

  const totalSize = parseInt(response.headers.get("Content-Length") || "0");

  // Create progress bar if we have a logger and total size
  let progressBar;
  if (logger && totalSize > 0) {
    progressBar = new cliProgress.SingleBar({
      format:
        "Downloading |{bar}| {percentage}% | {downloaded}/{totalSize} | {speed} | ETA: {eta}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    });
    progressBar.start(totalSize, 0, {
      downloaded: fileSize(0, true),
      totalSize: fileSize(totalSize, true),
      speed: "0 B/s",
      eta: "calculating...",
    });
  }

  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  let startTime = Date.now();
  let lastUpdateTime = startTime;
  let lastReceivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    receivedBytes += value.length;

    if (progressBar) {
      const now = Date.now();
      const timeDiff = (now - lastUpdateTime) / 1000; // seconds

      if (timeDiff >= 0.2) {
        // Update every 500ms for smoother display
        const speed = (receivedBytes - lastReceivedBytes) / timeDiff;
        const avgSpeed = receivedBytes / ((now - startTime) / 1000);
        const remainingBytes = totalSize - receivedBytes;
        const etaSeconds = avgSpeed > 0 ? remainingBytes / avgSpeed : 0;

        const formatTime = (seconds) => {
          if (seconds < 60) return `${Math.round(seconds)}s`;
          if (seconds < 3600)
            return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
          return `${Math.round(seconds / 3600)}h ${Math.round(
            (seconds % 3600) / 60
          )}m`;
        };

        progressBar.update(receivedBytes, {
          downloaded: fileSize(receivedBytes, true),
          totalSize: fileSize(totalSize, true),
          speed: `${fileSize(speed, true)}/s`,
          eta: formatTime(etaSeconds),
        });

        lastUpdateTime = now;
        lastReceivedBytes = receivedBytes;
      }
    }
  }

  if (progressBar) {
    progressBar.update(totalSize, {
      downloaded: fileSize(totalSize, true),
      totalSize: fileSize(totalSize, true),
      speed: "0 B/s",
      eta: "✓",
    });
    progressBar.stop();
  }

  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(destPath, buffer);

  const disposition = response.headers.get("Content-Disposition");
  const filenameRegex = /filename="?([^;"]+)"/;
  const match = disposition && disposition.match(filenameRegex);
  const filename = match?.[1] || url.substring(url.lastIndexOf("/") + 1);

  if (logger) {
    const totalTime = (Date.now() - startTime) / 1000;
    const avgSpeed = fileSize(receivedBytes / totalTime, true);
    logger.log(
      `Downloaded file: ${path.resolve(destPath)} (${fileSize(
        buffer.byteLength,
        true
      )}) in ${totalTime.toFixed(1)}s (avg: ${avgSpeed}/s)`
    );
  }

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
  if (!markdown) return null;

  const codeBlockRegex =
    /(?:(?:```(?<lang>\w*)?\n(?<code>[\s\S]*?)```)|(?:\s+\n(?:\t| +)(?<code2>[\s\S]*?)\n))/;
  const codeBlocks = markdown
    .match(new RegExp(codeBlockRegex, "g"))
    ?.filter(Boolean)
    .map(
      (code) =>
        code?.match(codeBlockRegex)?.groups?.code ||
        code?.match(codeBlockRegex)?.groups?.code2
    )
    .map((i) => i?.trim())
    .filter(Boolean);

  return codeBlocks?.length ? codeBlocks[0] : null;
};

const SCRIPT_DETECTION_CONFIG = {
  MIN_SCORE_THRESHOLD: 5,
  MAX_CODE_LINES: 10,
  REJECTION_KEYWORDS: [
    "installing",
    "](#",
    "](http",
    "- [",
    "ls",
    "cd",
    "pwd",
    "echo",
    "cat",
    "grep",
    "brew update",
    "brew upgrade",
    "sed",
  ],
  SCORE_WEIGHTS: {
    HIGH: 10,
    MEDIUM: 5,
    LOW: 2,
    BONUS_SHORT: 5,
    BONUS_MEDIUM: 3,
  },
  KEYWORD_CATEGORIES: {
    high: ["| sh", "| bash", "curl -s", "wget -q"],
    medium: ["install", "setup", "installer.sh", ".sh", "sudo"],
    low: [
      "~/.oh-my-zsh",
      "zinit light",
      "sudo emerge",
      "brew",
      "apt",
      "yum",
      "dnf",
    ],
  },
};

const isInstallScript = (code) => {
  if (!code || typeof code !== "string") return false;

  const lowerCode = code.toLowerCase().trim();
  const { REJECTION_KEYWORDS, MAX_CODE_LINES, MIN_SCORE_THRESHOLD } =
    SCRIPT_DETECTION_CONFIG;

  // Reject obvious non-install scripts
  if (
    REJECTION_KEYWORDS.some((keyword) => lowerCode.includes(keyword)) ||
    lowerCode.split("\n").length > MAX_CODE_LINES
  ) {
    return false;
  }

  return scoreSnippet(code) >= MIN_SCORE_THRESHOLD;
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const countKeywordMatches = (text, keyword) => {
  const regex = new RegExp(escapeRegex(keyword), "g");
  return (text.match(regex) || []).length;
};

const scoreSnippet = (code) => {
  if (!code || typeof code !== "string") return 0;

  const lowerCode = code.toLowerCase();
  let score = 0;
  const { SCORE_WEIGHTS, KEYWORD_CATEGORIES } = SCRIPT_DETECTION_CONFIG;

  // Score by keyword categories
  Object.entries(KEYWORD_CATEGORIES).forEach(([category, keywords]) => {
    const weight = SCORE_WEIGHTS[category.toUpperCase()];
    if (!weight) return; // Skip if weight not found

    keywords.forEach((keyword) => {
      const count = countKeywordMatches(lowerCode, keyword);
      score += count * weight;
    });
  });

  // Bonus for shorter, more focused scripts
  const nonEmptyLines = code
    .split("\n")
    .filter((line) => line.trim().length > 0).length;

  if (nonEmptyLines <= 2) score += SCORE_WEIGHTS.BONUS_SHORT;
  if (nonEmptyLines <= 3) score += SCORE_WEIGHTS.BONUS_MEDIUM;

  return Math.max(0, score); // Ensure non-negative score
};

const DEFAULT_BRANCHES = ["main", "master"];
const CODE_BLOCK_REGEX =
  /(?:(?:```(?<lang>\w*)?\n(?<code>[\s\S]*?)```)|(?:\s+\n(?:\t| +)(?<code2>[\s\S]*?)\n))/;

const extractCodeBlocks = (readme) => {
  if (!readme || typeof readme !== "string") return [];

  try {
    const matches = readme.match(new RegExp(CODE_BLOCK_REGEX, "g"));
    if (!matches) return [];

    return matches
      .filter(Boolean)
      .map((code) => {
        const match = code.match(CODE_BLOCK_REGEX);
        return match?.groups?.code || match?.groups?.code2;
      })
      .map((code) => code?.trim())
      .filter(Boolean);
  } catch (error) {
    return [];
  }
};

const normalizeCode = (code) => code.replace(/\s+/g, " ").trim();

const createScriptSnippet = (code, source) => ({
  code,
  source,
  score: scoreSnippet(code),
});

const fetchReadmeFromBranch = async (owner, repo, branch) => {
  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`,
      { timeout: 5000 } // 5 second timeout
    );

    if (!response.ok) return null;

    const readme = await response.text();
    return extractCodeBlocks(readme)
      .filter(isInstallScript)
      .map((code) => createScriptSnippet(code, `readme (${branch})`));
  } catch (error) {
    return null;
  }
};

const findInstallScripts = async (owner, repo, body) => {
  const snippets = [];

  // Check release body first
  const releaseCode = getCodeFromMarkdown(body)?.trim();
  if (releaseCode && isInstallScript(releaseCode)) {
    snippets.push(createScriptSnippet(releaseCode, "release"));
  }

  // Check README from different branches
  for (const branch of DEFAULT_BRANCHES) {
    const branchSnippets = await fetchReadmeFromBranch(owner, repo, branch);
    if (branchSnippets) {
      snippets.push(...branchSnippets);
    }
  }

  // Sort by score (highest first) and remove duplicates
  const uniqueSnippets = [];
  const seenCodes = new Set();

  snippets
    .sort((a, b) => b.score - a.score)
    .forEach((snippet) => {
      const normalizedCode = normalizeCode(snippet.code);
      if (!seenCodes.has(normalizedCode)) {
        seenCodes.add(normalizedCode);
        uniqueSnippets.push(snippet);
      }
    });

  return uniqueSnippets;
};

const hasHighPriorityInstallScript = (installScripts) => {
  if (!installScripts || installScripts.length === 0) return false;

  const { KEYWORD_CATEGORIES } = SCRIPT_DETECTION_CONFIG;
  const highPriorityKeywords = KEYWORD_CATEGORIES.high;

  return installScripts.some((script) => {
    const lowerCode = script.code.toLowerCase();
    return highPriorityKeywords.some((keyword) =>
      lowerCode.includes(keyword.toLowerCase())
    );
  });
};

module.exports = {
  parseSource,
  getGitHubAssets,
  getWebsiteAssets,
  trySmartDownload,
  downloadFromUrl,
  getExtension,
  findInstallScripts,
  scoreSnippet,
  isInstallScript,
  isIgnored,
  hasHighPriorityInstallScript,
};
