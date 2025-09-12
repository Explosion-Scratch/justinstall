const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const getConfigDir = () => {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configHome = xdgConfigHome || path.join(os.homedir(), ".config");
  return path.join(configHome, "justinstall");
};

const getConfigPath = () => {
  return path.join(getConfigDir(), "installations.json");
};

const ensureConfigDir = () => {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  return configDir;
};

const loadConfig = () => {
  try {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    return [];
  }
};

const saveConfig = (config) => {
  ensureConfigDir();
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
};

const addInstallation = (installData) => {
  const config = loadConfig();
  const existingIndex = config.findIndex(
    (item) => item.name === installData.name
  );

  if (existingIndex !== -1) {
    config[existingIndex] = installData;
  } else {
    config.push(installData);
  }

  saveConfig(config);
};

const getInstallation = (name) => {
  const config = loadConfig();
  return config.find((item) => item.name === name);
};

const removeInstallation = (name) => {
  const config = loadConfig();
  const filtered = config.filter((item) => item.name !== name);
  saveConfig(filtered);
};

const hashFile = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
};

const createInstallationRecord = (source, selected, metadata = {}) => {
  return {
    name: metadata.name || extractName(selected),
    date: new Date().toISOString(),
    source: {
      type: source.type, // 'github', 'url', 'file'
      url: source.url,
      owner: source.owner,
      repo: source.repo,
      originalArgs: source.originalArgs,
    },
    selected: {
      name: selected.name,
      size: selected.size,
      extension: selected.extension,
      downloadUrl: selected.browser_download_url || source.url,
      hash: metadata.hash,
    },
    installation: {
      method: metadata.installMethod,
      binaries: metadata.binaries || [],
      destinations: metadata.destinations || [],
    },
    version: metadata.version,
    commit: metadata.commit,
  };
};

const extractName = (selected) => {
  return selected.name
    .replace(/\.(tar\.gz|tar\.xz|zip|dmg|pkg|deb|app)$/i, "")
    .replace(/v?[0-9]+\.[0-9]+\.[0-9]+/i, "")
    .replace(/[-_]+(?:darwin|linux|windows|mac|osx|apple|x64|arm64|aarch64|universal|amd64)[-_]*/gi, "")
    .replace(/(?:darwin|linux|windows|mac|osx|apple|x64|arm64|aarch64|universal|amd64)[-_]*/gi, "")
    .replace(/[-_]+(?:darwin|linux|windows|mac|osx|apple|x64|arm64|aarch64|universal|amd64)$/gi, "")
    .replace(/^(?:darwin|linux|windows|mac|osx|apple|x64|arm64|aarch64|universal|amd64)[-_]+/gi, "")
    .replace(/[0-9]+\.[0-9]+\.[0-9]+/i, "")
    .replace(/[-_]+$/, "")
    .replace(/^[-_]+/, "")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/os$/, "");
};

module.exports = {
  getConfigDir,
  getConfigPath,
  ensureConfigDir,
  loadConfig,
  saveConfig,
  addInstallation,
  getInstallation,
  removeInstallation,
  hashFile,
  createInstallationRecord,
  extractName,
};
