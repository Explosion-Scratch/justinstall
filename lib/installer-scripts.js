const fs = require('fs')
const path = require('path')
const os = require('os')
const { safeExecSync } = require('./utils')

/**
 * Platform-specific installer script configuration
 * Maps file extensions to their platform compatibility and execution methods
 */
const INSTALLER_SCRIPT_CONFIG = {
  command: {
    platforms: ['darwin'],
    description: 'macOS Command Script',
    executor: 'sh',
    priority: 10,
    patterns: ['install', 'setup', 'macos', 'mac', 'osx']
  },
  sh: {
    platforms: ['darwin', 'linux', 'freebsd', 'openbsd'],
    description: 'Shell Script',
    executor: 'sh',
    priority: 8,
    patterns: ['install', 'setup', 'linux']
  },
  bash: {
    platforms: ['darwin', 'linux', 'freebsd', 'openbsd'],
    description: 'Bash Script',
    executor: 'bash',
    priority: 8,
    patterns: ['install', 'setup', 'linux']
  },
  zsh: {
    platforms: ['darwin', 'linux', 'freebsd', 'openbsd'],
    description: 'Zsh Script',
    executor: 'zsh',
    priority: 7,
    patterns: ['install', 'setup']
  },
  bat: {
    platforms: ['win32'],
    description: 'Windows Batch Script',
    executor: 'cmd',
    executorArgs: ['/c'],
    priority: 10,
    patterns: ['install', 'setup', 'windows', 'win']
  },
  cmd: {
    platforms: ['win32'],
    description: 'Windows Command Script',
    executor: 'cmd',
    executorArgs: ['/c'],
    priority: 9,
    patterns: ['install', 'setup', 'windows', 'win']
  },
  ps1: {
    platforms: ['win32'],
    description: 'PowerShell Script',
    executor: 'powershell',
    executorArgs: ['-ExecutionPolicy', 'Bypass', '-File'],
    priority: 8,
    patterns: ['install', 'setup', 'windows', 'win']
  }
}

/**
 * Get all supported installer script extensions
 * @returns {string[]} Array of supported extensions
 */
const getInstallerScriptExtensions = () => Object.keys(INSTALLER_SCRIPT_CONFIG)

/**
 * Check if a file extension is an installer script
 * @param {string} extension - File extension (without dot)
 * @returns {boolean} True if it's an installer script extension
 */
const isInstallerScript = (extension) => {
  if (!extension) return false
  return INSTALLER_SCRIPT_CONFIG.hasOwnProperty(extension.toLowerCase())
}

/**
 * Check if an installer script is compatible with the current platform
 * @param {string} extension - File extension
 * @returns {boolean} True if compatible with current platform
 */
const isInstallerScriptCompatible = (extension) => {
  if (!extension) return false
  const config = INSTALLER_SCRIPT_CONFIG[extension.toLowerCase()]
  if (!config) return false
  return config.platforms.includes(process.platform)
}

/**
 * Get installer script configuration
 * @param {string} extension - File extension
 * @returns {Object|null} Configuration object or null if not found
 */
const getInstallerScriptConfig = (extension) => {
  if (!extension) return null
  return INSTALLER_SCRIPT_CONFIG[extension.toLowerCase()] || null
}

/**
 * Score an installer script based on filename relevance to current platform
 * @param {string} filePath - Path to the script (relative or absolute)
 * @param {string} extension - File extension
 * @returns {number} Score (higher is better match)
 */
const scoreInstallerScript = (filePath, extension) => {
  if (!isInstallerScriptCompatible(extension)) return -1

  const config = INSTALLER_SCRIPT_CONFIG[extension.toLowerCase()]
  let score = config.priority

  const filename = path.basename(filePath);
  const lowerFilename = filename.toLowerCase()
  const lowerPath = filePath.toLowerCase()
  const platform = process.platform

  const platformNameMatches = {
    darwin: ['macos', 'mac', 'osx', 'darwin', 'apple'],
    linux: ['linux', 'ubuntu', 'debian', 'centos', 'fedora', 'arch'],
    win32: ['windows', 'win', 'win32', 'win64']
  }

  const myPlatformPatterns = platformNameMatches[platform] || []
  const otherPlatformPatterns = Object.entries(platformNameMatches)
    .filter(([p]) => p !== platform)
    .flatMap(([, patterns]) => patterns)

  for (const pattern of myPlatformPatterns) {
    if (lowerFilename.includes(pattern)) {
      score += 10
      break
    }
  }

  for (const pattern of otherPlatformPatterns) {
    if (lowerFilename.includes(pattern)) {
      return -1
    }
  }

  // Penalize completion scripts heavily
  // Check directory path for 'completion' or 'completions'
  const dirname = path.dirname(filePath).toLowerCase();
  
  if (
    dirname.includes('completion') || 
    dirname.includes('completions') ||
    dirname.includes('examples') ||
    dirname.includes('samples') ||
    dirname.includes('test') ||
    dirname.includes('t/') || // Common test directory
    lowerFilename.includes('completion') ||
    lowerFilename.startsWith('_') || // Common zsh completion prefix
    lowerFilename.includes('.min.') // Minified files are rarely installers
  ) {
    return -1; // Exclude completely
  }

  for (const pattern of config.patterns) {
    if (lowerFilename.includes(pattern)) {
      score += 3
    }
  }

  return score
}

/**
 * Detect installer scripts from a list of files
 * @param {string[]} files - List of file paths/names
 * @param {string} basePath - Base directory path
 * @returns {Object[]} Array of detected installer scripts with scores
 */
const detectInstallerScripts = (files, basePath = '') => {
  const scripts = []

  for (const file of files) {
    const filename = path.basename(file)
    const ext = path.extname(filename).slice(1).toLowerCase()

    if (!isInstallerScript(ext)) continue
    if (!isInstallerScriptCompatible(ext)) continue

    const score = scoreInstallerScript(file, ext)
    if (score < 0) continue

    scripts.push({
      path: file,
      fullPath: basePath ? path.join(basePath, file) : file,
      filename,
      extension: ext,
      config: getInstallerScriptConfig(ext),
      score
    })
  }

  return scripts.sort((a, b) => b.score - a.score)
}

/**
 * Find the best installer script for the current platform
 * @param {string[]} files - List of file paths/names
 * @param {string} basePath - Base directory path
 * @returns {Object|null} Best matching script or null
 */
const findBestInstallerScript = (files, basePath = '') => {
  const scripts = detectInstallerScripts(files, basePath)
  return scripts.length > 0 ? scripts[0] : null
}

/**
 * Execute an installer script
 * @param {string} scriptPath - Path to the script
 * @param {string} extension - Script extension
 * @param {Object} options - Execution options
 * @param {Object} logger - Optional logger
 * @returns {Object} Execution result
 */
const executeInstallerScript = (scriptPath, extension, options = {}, logger = null) => {
  const config = getInstallerScriptConfig(extension)
  if (!config) {
    throw new Error(`Unknown installer script type: ${extension}`)
  }

  if (!isInstallerScriptCompatible(extension)) {
    throw new Error(
      `Script type .${extension} is not compatible with ${process.platform}`
    )
  }

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Installer script not found: ${scriptPath}`)
  }

  const absPath = path.resolve(scriptPath)

  try {
    fs.chmodSync(absPath, '755')
    if (logger) logger.debug(`Made ${absPath} executable`)
  } catch (e) {
    if (logger) logger.warn(`Could not chmod script: ${e.message}`)
  }

  if (logger) {
    logger.log(`Running ${config.description}: ${path.basename(scriptPath)}`)
  }

  const args = config.executorArgs
    ? [...config.executorArgs, absPath]
    : [absPath]

  try {
    safeExecSync(config.executor, args, {
      stdio: 'inherit',
      cwd: path.dirname(absPath),
      ...options
    })

    return {
      success: true,
      scriptPath: absPath,
      extension,
      method: `installer_script_${extension}`
    }
  } catch (error) {
    throw new Error(`Failed to execute installer script: ${error.message}`)
  }
}

/**
 * Preview an installer script's contents
 * @param {string} scriptPath - Path to the script
 * @param {number} maxLines - Maximum lines to show
 * @returns {string} Script preview
 */
const previewInstallerScript = (scriptPath, maxLines = 20) => {
  if (!fs.existsSync(scriptPath)) {
    return '[Script not found]'
  }

  const content = fs.readFileSync(scriptPath, 'utf-8')
  const lines = content.split('\n')

  if (lines.length <= maxLines) {
    return content
  }

  return (
    lines.slice(0, maxLines).join('\n') +
    `\n\n... (${lines.length - maxLines} more lines)`
  )
}

/**
 * Get platform-specific installer script patterns for filtering
 * @returns {Object} Object with compatible and incompatible patterns
 */
const getPlatformInstallerPatterns = () => {
  const platform = process.platform

  const compatibleExtensions = Object.entries(INSTALLER_SCRIPT_CONFIG)
    .filter(([, config]) => config.platforms.includes(platform))
    .map(([ext]) => ext)

  const incompatibleExtensions = Object.entries(INSTALLER_SCRIPT_CONFIG)
    .filter(([, config]) => !config.platforms.includes(platform))
    .map(([ext]) => ext)

  return {
    compatible: compatibleExtensions,
    incompatible: incompatibleExtensions
  }
}

module.exports = {
  INSTALLER_SCRIPT_CONFIG,
  getInstallerScriptExtensions,
  isInstallerScript,
  isInstallerScriptCompatible,
  getInstallerScriptConfig,
  scoreInstallerScript,
  detectInstallerScripts,
  findBestInstallerScript,
  executeInstallerScript,
  previewInstallerScript,
  getPlatformInstallerPatterns
}
