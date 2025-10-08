const path = require("path");
const { safeExecSync } = require("./utils");

/**
 * Extension configuration registry
 * Central place for all extension-related metadata
 */
const EXTENSION_CONFIG = {
  // Archive types
  archives: {
    "tar.gz": { priority: 1, extractable: true },
    "tar.xz": { priority: 1, extractable: true },
    "tar.bz2": { priority: 1, extractable: true },
    zip: { priority: 2, extractable: true },
    "tar.zst": { priority: 1, extractable: true },
    "7z": { priority: 2, extractable: true },
  },

  // Installable package types
  packages: {
    dmg: { platforms: ["darwin"], priority: 10, installable: true },
    pkg: { platforms: ["darwin"], priority: 9, installable: true },
    app: { platforms: ["darwin"], priority: 8, installable: true },
    deb: { platforms: ["linux"], priority: 10, installable: true },
    rpm: { platforms: ["linux"], priority: 9, installable: true },
    AppImage: { platforms: ["linux"], priority: 8, installable: true },
    exe: { platforms: ["win32"], priority: 10, installable: true },
    msi: { platforms: ["win32"], priority: 9, installable: true },
  },

  // Platform-specific boosters (preferred formats)
  platformBoosters: {
    darwin: ["dmg", "pkg", "app"],
    linux: ["AppImage", "deb", "rpm"],
    win32: ["exe", "msi"],
  },

  // All installable extensions (union of archives and packages)
  get installable() {
    return [...Object.keys(this.archives), ...Object.keys(this.packages)];
  },
};

/**
 * Platform capability checking
 */
const getInstallCapabilities = () => {
  const ebool = (cmd) => {
    try {
      return safeExecSync(cmd, [], { stdio: "ignore" }).length > 0;
    } catch (e) {
      return false;
    }
  };

  return {
    deb: process.platform === "linux" && ebool("which dpkg"),
    dmg: process.platform === "darwin",
    pkg: process.platform === "darwin",
    app: process.platform === "darwin",
    rpm: process.platform === "linux" && ebool("which rpm"),
    "tar.zst": ebool("which unzstd") || ebool("which zstd"),
  };
};

/**
 * Extract extension from filename
 * Handles compound extensions like tar.gz, tar.xz, etc.
 */
const getExtension = (filename) => {
  if (!filename || typeof filename !== "string") return "";
  
  const parts = filename.split(".");
  if (parts.length === 1) return "";
  
  // Handle compound extensions
  const compoundExtensions = ["tar.gz", "tar.xz", "tar.bz2"];
  const potentialCompound = parts.slice(-2).join(".");
  
  if (compoundExtensions.includes(potentialCompound)) {
    return potentialCompound;
  }
  
  return parts.pop();
};

/**
 * Check if an extension is installable
 */
const isInstallable = (extension) => {
  return EXTENSION_CONFIG.installable.includes(extension);
};

/**
 * Check if an extension is an archive type
 */
const isArchive = (extension) => {
  return Object.keys(EXTENSION_CONFIG.archives).includes(extension);
};

/**
 * Check if an extension is a package type
 */
const isPackage = (extension) => {
  return Object.keys(EXTENSION_CONFIG.packages).includes(extension);
};

/**
 * Get platform-specific boosted extensions
 */
const getBoostedExtensions = (platform) => {
  return EXTENSION_CONFIG.platformBoosters[platform] || [];
};

/**
 * Check if extension is supported on current platform
 */
const isExtensionSupported = (extension, platform, capabilities) => {
  if (!extension) return true; // No extension means could be executable
  
  // Check if it's a package type and if platform supports it
  if (isPackage(extension)) {
    const packageConfig = EXTENSION_CONFIG.packages[extension];
    if (packageConfig.platforms && !packageConfig.platforms.includes(platform)) {
      return false;
    }
  }
  
  // Check installation capabilities
  if (capabilities[extension] === false) {
    return false;
  }
  
  return isInstallable(extension);
};

/**
 * Extract archive based on extension
 */
const extractArchive = (filePath, outputDir, extension) => {
  if (!isArchive(extension)) {
    // For files without known extensions, just copy them
    const filename = path.basename(filePath);
    const fs = require("fs");
    fs.renameSync(filePath, path.join(outputDir, filename));
    return;
  }

  switch (extension) {
    case "tar.gz":
      safeExecSync("tar", ["-xzf", filePath, "--directory", outputDir]);
      break;
    case "tar.xz":
      safeExecSync("tar", ["-xJf", filePath, "--directory", outputDir]);
      break;
    case "tar.bz2":
      safeExecSync("tar", ["-jf", filePath, "--directory", outputDir]);
      break;
    case "zip":
      safeExecSync("unzip", [filePath, "-d", outputDir]);
      break;
    case "tar.zst":
      safeExecSync("sh", [
        "-c",
        `unzstd < ${JSON.stringify(filePath)} | tar -xf - --directory ${JSON.stringify(outputDir)}`,
      ]);
      break;
    case "7z":
      safeExecSync("7z", ["x", filePath, `-o${outputDir}`]);
      break;
    default:
      throw new Error(`Unsupported archive format: ${extension}`);
  }
};

/**
 * Score asset based on extension and platform compatibility
 */
const scoreAssetByExtension = (asset, platform, capabilities) => {
  if (!asset.extension) return 0;
  
  let score = 0;
  const { extension } = asset;
  
  // Check if extension is supported
  if (!isExtensionSupported(extension, platform, capabilities)) {
    return -1; // Mark as incompatible
  }
  
  // Archive vs Package scoring
  if (isArchive(extension)) {
    score += EXTENSION_CONFIG.archives[extension]?.priority || 1;
  } else if (isPackage(extension)) {
    score += EXTENSION_CONFIG.packages[extension]?.priority || 1;
  }
  
  // Platform-specific boosting
  const boostedExtensions = getBoostedExtensions(platform);
  if (boostedExtensions.includes(extension)) {
    score += 5; // Significant boost for platform-preferred formats
  }
  
  // Extra boost for DMGs/PKGs that match architecture (for macOS)
  if ((extension === "dmg" || extension === "pkg") && platform === "darwin") {
    score += 2;
  }
  
  // Cross-platform penalty
  if ((extension === "exe" || extension === "msi") && platform !== "win32") {
    return -1; // Mark as incompatible
  }
  
  return score;
};

/**
 * Filter assets based on extension compatibility
 */
const filterAssetsByExtensions = (assets, platform, capabilities) => {
  return assets.filter(asset => {
    if (!asset.extension) return true; // Keep assets without extensions
    
    return isExtensionSupported(asset.extension, platform, capabilities);
  });
};

/**
 * Sort assets by extension priority and platform preference
 */
const sortAssetsByExtension = (assets, platform, capabilities) => {
  return assets
    .map(asset => ({
      ...asset,
      extensionScore: scoreAssetByExtension(asset, platform, capabilities)
    }))
    .filter(asset => asset.extensionScore >= 0) // Remove incompatible assets
    .sort((a, b) => b.extensionScore - a.extensionScore);
};

/**
 * Get all installable extensions (for backward compatibility)
 */
const getInstallableExtensions = () => {
  return [...EXTENSION_CONFIG.installable];
};

/**
 * Get extension metadata
 */
const getExtensionInfo = (extension) => {
  if (isArchive(extension)) {
    return { type: "archive", ...EXTENSION_CONFIG.archives[extension] };
  }
  if (isPackage(extension)) {
    return { type: "package", ...EXTENSION_CONFIG.packages[extension] };
  }
  return null;
};

module.exports = {
  // Extension processing
  getExtension,
  isInstallable,
  isArchive,
  isPackage,
  
  // Platform compatibility
  getInstallCapabilities,
  isExtensionSupported,
  getBoostedExtensions,
  
  // Asset processing
  scoreAssetByExtension,
  filterAssetsByExtensions,
  sortAssetsByExtension,
  
  // Archive handling
  extractArchive,
  
  // Configuration access
  getInstallableExtensions,
  getExtensionInfo,
  EXTENSION_CONFIG,
};