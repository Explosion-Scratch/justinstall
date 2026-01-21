const fs = require("fs");
const path = require("path");
const { getInstallableExtensions } = require("./extensions");

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
  "_internal",
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
      // Check if it's a specific release URL
      const releaseMatch = input.match(/github\.com\/([^\/]+)\/([^\/]+)\/releases\/tag\/([^\/]+)/i);
      if (releaseMatch) {
        const [, owner, repo, tag] = releaseMatch;
        return {
          type: "github",
          url: input,
          owner,
          repo,
          specificTag: tag,
          originalArgs: [input],
        };
      }

      // Regular GitHub repo URL
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

const getGitHubAssets = async (owner, repo, specificTag = null) => {
  let release;

  if (specificTag) {
    // Fetch specific release by tag
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/tags/${specificTag}`,
      {
        headers: {
          "User-Agent": "justinstall/1.2.0",
        },
      }
    );
    if (!response.ok) {
      throw new Error(`Release with tag "${specificTag}" not found`);
    }
    release = await response.json();
  } else {
    // Try to get the latest stable release first
    let response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
      {
        headers: {
          "User-Agent": "justinstall/1.2.0",
        },
      }
    );

    if (response.ok) {
      release = await response.json();
    } else if (response.status === 404) {
      // No stable releases found, get all releases and find the latest prerelease
      const allReleasesResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases`,
        {
          headers: {
            "User-Agent": "justinstall/1.2.0",
          },
        }
      );

      if (!allReleasesResponse.ok) {
        throw new Error("No releases found in GitHub repository");
      }

      const allReleases = await allReleasesResponse.json();

      if (allReleases.length === 0) {
        throw new Error("No releases found in GitHub repository");
      }

      // Find the most recent release (including prereleases)
      // Releases are already sorted by created_at in descending order
      release = allReleases[0];
    } else {
      throw new Error(`Failed to fetch GitHub releases: ${response.statusText}`);
    }
  }

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
    prerelease: release.prerelease,
  };
};

const INSTALLABLE_EXTENSIONS = getInstallableExtensions();

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
      "User-Agent": "Mozilla/5.0 (compatible; justinstall/1.2.0)",
      Accept: "*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.statusText}`);
  }

  // Get first chunk to check if it's HTML
  const reader = response.body.getReader();
  const { value: firstChunk, done } = await reader.read();

  if (done) {
    throw new Error("Empty response from URL");
  }

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

    const tempPath = path.join(require("os").tmpdir(), `justinstall-${Date.now()}-${filename}`);
    fs.writeFileSync(tempPath, fullBuffer);

    return {
      type: "direct_download",
      filename,
      buffer: fullBuffer,
      size: fullBuffer.length,
      url,
      localPath: tempPath,
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
      "User-Agent": "Mozilla/5.0 (compatible; justinstall/1.2.0)",
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
        // Update every 200ms for smoother display
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

const { getExtension } = require("./extensions");

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

  const rawCode = codeBlocks?.length ? codeBlocks[0] : null;
  return rawCode ? removeCommentLines(rawCode) : null;
};

const SCRIPT_DETECTION_CONFIG = {
  MIN_SCORE_THRESHOLD: 5,
  MAX_CODE_LINES: 10,
  REJECTION_KEYWORDS: [
    "](#",
    "](http",
    "- [",
    "brew update",
    "brew upgrade",
    "copy and paste",
    "```",
    "open powershell",
    "open terminal",
    "--merge-output-format",
    "--remux-video",
    "--audio-format",
    "--netrc-cmd",
    "machine ",
    "login ",
    "password ",
    "touch ",
    "section_title",
    "start_time",
    "chapter ",
    "today|yesterday",
  ],
  REJECTION_STARTSWITH: [
    "export ",
    "cp ",
    "sudo rm",
    "http://",
    "grep ",
    "sed ",
    "ls ",
    "echo ",
    "cat ",
    "cd ",
    "pwd",
    "-t ",
    "-f ",
    "touch ",
    "machine ",
  ],
  REJECTION_PATTERNS: [
    /\s*-+[a-z-]+/g,  // Command line flags
    /\s*\|.*\|/g,     // Table/pipe formatting
    /\s*`[^`]+`/g,    // Backtick formatting
    /\{[^}]*\}/g,     // Curly brace placeholders
  ],
  MAX_COMMAND_LENGTH: 200, // Reject very long commands
  MAX_FLAGS_COUNT: 5,      // Reject commands with too many flags
  SCORE_WEIGHTS: {
    HIGH: 10,
    MEDIUM: 5,
    LOW: 2,
    BONUS_SHORT: 5,
    BONUS_MEDIUM: 3,
    PENALTY_LONG: -5,
    PENALTY_MANY_FLAGS: -3,
    PENALTY_DOCUMENTATION: -10,
  },
  KEYWORD_CATEGORIES: {
    high: ["| sh", "| bash", "curl ", "wget ", "pip install", "npm install", "go install"],
    medium: ["install", "setup", "installer.sh", ".sh", "sudo", "make install"],
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
  const {
    REJECTION_KEYWORDS,
    REJECTION_STARTSWITH,
    REJECTION_PATTERNS,
    MAX_CODE_LINES,
    MAX_COMMAND_LENGTH,
    MAX_FLAGS_COUNT,
    MIN_SCORE_THRESHOLD,
  } = SCRIPT_DETECTION_CONFIG;

  const codeLines = code.split("\n").filter(line => line.trim().length > 0);

  // Reject if too many lines
  if (codeLines.length > MAX_CODE_LINES) {
    return false;
  }

  // Reject if any line is too long (likely documentation)
  if (codeLines.some(line => line.length > MAX_COMMAND_LENGTH)) {
    return false;
  }

  // Count flags across all lines
  const totalFlags = codeLines.reduce((count, line) => {
    const matches = line.match(/-[a-z-]+/g);
    return count + (matches ? matches.length : 0);
  }, 0);

  if (totalFlags > MAX_FLAGS_COUNT) {
    return false;
  }

  // Check rejection patterns
  for (const pattern of REJECTION_PATTERNS) {
    if (pattern.test(code)) {
      return false;
    }
  }

  // Reject obvious non-install scripts
  if (
    REJECTION_KEYWORDS.some((keyword) => lowerCode.includes(keyword)) ||
    REJECTION_STARTSWITH.some((keyword) => lowerCode.startsWith(keyword))
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
  const { SCORE_WEIGHTS, KEYWORD_CATEGORIES, MAX_COMMAND_LENGTH, MAX_FLAGS_COUNT } = SCRIPT_DETECTION_CONFIG;

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

  // Penalties for documentation-like content
  const codeLines = code.split("\n").filter(line => line.trim().length > 0);
  
  // Penalty for very long commands
  if (codeLines.some(line => line.length > MAX_COMMAND_LENGTH)) {
    score += SCORE_WEIGHTS.PENALTY_LONG;
  }

  // Penalty for too many flags
  const totalFlags = codeLines.reduce((count, line) => {
    const matches = line.match(/-[a-z-]+/g);
    return count + (matches ? matches.length : 0);
  }, 0);
  if (totalFlags > MAX_FLAGS_COUNT) {
    score += SCORE_WEIGHTS.PENALTY_MANY_FLAGS;
  }

  // Penalty for documentation patterns
  if (code.includes("`") || code.includes("|") || code.includes("{")) {
    score += SCORE_WEIGHTS.PENALTY_DOCUMENTATION;
  }

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

const removeCommentLines = (code) => {
  if (!code || typeof code !== 'string') return code;

  return code
    .split('\n')
    .filter(line => {
      const trimmedLine = line.trim();

      // Preserve shebang lines
      if (trimmedLine.startsWith('#!')) {
        return true;
      }

      // Remove lines that start with common comment patterns
      return !(
        trimmedLine.startsWith('#') ||
        trimmedLine.startsWith('//') ||
        trimmedLine.startsWith('/*') ||
        trimmedLine.startsWith('*') ||
        trimmedLine.startsWith('"""') ||
        trimmedLine.startsWith("'''") ||
        trimmedLine.startsWith('--') ||
        trimmedLine.startsWith('::') ||
        trimmedLine.startsWith('REM') ||
        trimmedLine.startsWith('rem')
      );
    })
    .join('\n')
    .trim();
};

const createScriptSnippet = (code, source) => {
  const cleanedCode = removeCommentLines(code);
  return {
    code: cleanedCode,
    source,
    score: scoreSnippet(cleanedCode),
  };
};

const fetchReadmeFromBranch = async (owner, repo, branch) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "justinstall/1.2.0",
        }
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const readme = await response.text();
    return extractCodeBlocks(readme)
      .filter(isInstallScript)
      .map((code) => createScriptSnippet(code, `readme (${branch})`));
  } catch (error) {
    return null;
  }
};

const PLATFORM_SCRIPT_PATTERNS = {
  darwin: {
    compatible: [
      "brew ",
      "brew install",
      "port install",
      "curl ",
      "wget ",
      "| sh",
      "| bash",
      "pip install",
      "pip3 install",
      "npm install",
      "go install",
      "cargo install",
      "mas install",
    ],
    incompatible: [
      "apt ",
      "apt-get ",
      "dnf ",
      "yum ",
      "zypper ",
      "pacman ",
      "emerge ",
      "eopkg ",
      "apk ",
      "dpkg ",
      "rpm ",
      "snap ",
      "flatpak ",
      "nix-env",
      "scoop ",
      "choco ",
      "winget ",
      "powershell",
      ".exe",
      "apt install",
      "apt-get install",
      "dnf install",
      "yum install",
      "zypper install",
      "pacman -S",
      "sudo emerge",
      "eopkg install",
      "apk add",
      "dnf copr",
      "opensuse",
    ],
  },
  linux: {
    compatible: [
      "apt ",
      "apt-get ",
      "dnf ",
      "yum ",
      "zypper ",
      "pacman ",
      "emerge ",
      "eopkg ",
      "apk ",
      "snap ",
      "flatpak ",
      "nix-env",
      "curl ",
      "wget ",
      "| sh",
      "| bash",
      "pip install",
      "pip3 install",
      "npm install",
      "go install",
      "cargo install",
    ],
    incompatible: [
      "brew ",
      "port install",
      "mas install",
      "scoop ",
      "choco ",
      "winget ",
      "powershell",
      ".exe",
      ".dmg",
      ".pkg",
      ".app",
    ],
  },
  win32: {
    compatible: [
      "scoop ",
      "choco ",
      "winget ",
      "powershell",
      ".exe",
      "curl ",
      "pip install",
      "npm install",
      "go install",
      "cargo install",
    ],
    incompatible: [
      "brew ",
      "apt ",
      "dnf ",
      "yum ",
      "pacman ",
      "port install",
      "mas install",
      ".dmg",
      ".pkg",
      ".app",
      ".deb",
      ".rpm",
    ],
  },
};

const getScriptPlatformCompatibility = (code) => {
  const platform = process.platform;
  const lowerCode = code.toLowerCase();
  const patterns = PLATFORM_SCRIPT_PATTERNS[platform] || PLATFORM_SCRIPT_PATTERNS.darwin;

  let compatibilityScore = 0;
  let isExplicitlyIncompatible = false;

  for (const pattern of patterns.incompatible) {
    if (lowerCode.includes(pattern.toLowerCase())) {
      isExplicitlyIncompatible = true;
      compatibilityScore -= 100;
    }
  }

  for (const pattern of patterns.compatible) {
    if (lowerCode.includes(pattern.toLowerCase())) {
      compatibilityScore += 10;
    }
  }

  return {
    isCompatible: !isExplicitlyIncompatible,
    score: compatibilityScore,
    platform,
  };
};

const filterScriptsByPlatform = (scripts) => {
  return scripts
    .map((script) => {
      const compatibility = getScriptPlatformCompatibility(script.code);
      return {
        ...script,
        platformCompatibility: compatibility,
        adjustedScore: script.score + compatibility.score,
      };
    })
    .filter((script) => script.platformCompatibility.isCompatible)
    .sort((a, b) => b.adjustedScore - a.adjustedScore);
};

const findInstallScripts = async (owner, repo, body) => {
  const snippets = [];

  const releaseCode = getCodeFromMarkdown(body)?.trim();
  if (releaseCode && isInstallScript(releaseCode)) {
    snippets.push(createScriptSnippet(releaseCode, "release"));
  }

  for (const branch of DEFAULT_BRANCHES) {
    const branchSnippets = await fetchReadmeFromBranch(owner, repo, branch);
    if (branchSnippets) {
      snippets.push(...branchSnippets);
    }
  }

  const uniqueSnippets = [];
  const seenCodes = new Set();

  const sortedSnippets = snippets.sort((a, b) => b.score - a.score);

  sortedSnippets.forEach((snippet) => {
    const normalizedCode = normalizeCode(snippet.code);
    if (!seenCodes.has(normalizedCode)) {
      seenCodes.add(normalizedCode);
      uniqueSnippets.push(snippet);
    }
  });

  const platformFilteredSnippets = filterScriptsByPlatform(uniqueSnippets);

  const keepCount = Math.max(1, Math.ceil(platformFilteredSnippets.length / 2));
  const filteredSnippets = platformFilteredSnippets.slice(0, keepCount);

  return filteredSnippets;
};

const getHighestScriptScore = (installScripts) => {
  if (!installScripts || installScripts.length === 0) return 0;
  return Math.max(...installScripts.map((s) => s.adjustedScore || s.score));
};

const hasHighPriorityInstallScript = (installScripts, binaryScore = 0) => {
  if (!installScripts || installScripts.length === 0) return false;

  const highestScriptScore = getHighestScriptScore(installScripts);

  if (binaryScore > 0 && highestScriptScore <= binaryScore) {
    return false;
  }

  const { KEYWORD_CATEGORIES } = SCRIPT_DETECTION_CONFIG;
  const highPriorityKeywords = KEYWORD_CATEGORIES.high;

  return installScripts.some((script) => {
    if (!script.platformCompatibility?.isCompatible) return false;
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
  removeCommentLines,
  getHighestScriptScore,
};
