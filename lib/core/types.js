const path = require('path')
const os = require('os')

const SOURCE_TYPES = {
  ASSET: 'asset',
  SCRIPT: 'script'
}

const URL_TYPES = {
  GITHUB: 'github',
  GITLAB: 'gitlab',
  DIRECT: 'direct',
  WEBSITE: 'website',
  FILE: 'file'
}

const PHASES = ['detect', 'source', 'filter', 'select', 'download', 'install']

function createSource(options) {
  return {
    url: options.url || null,
    type: options.type || SOURCE_TYPES.ASSET,
    name: options.name || 'Unknown',
    size: options.size || null,
    extension: options.extension || null,
    priority: options.priority || 0,
    confidence: options.confidence || 50,
    module: options.module || 'Unknown',

    code: options.code || null,
    scriptSource: options.scriptSource || null,

    archCompatible: true,
    platformCompatible: true,
    archScore: 0,

    prerelease: options.prerelease || false,
    
    ...options
  }
}

function createPlatformInfo() {
  const arch = process.arch
  const platform = process.platform

  const archAliases = {
    arm64: ['arm64', 'aarch64', 'arm', 'm1', 'm2', 'm3', 'm4', 'silicon', 'apple'],
    x64: ['x64', 'x86_64', 'amd64', 'intel', 'x86-64'],
    universal: ['universal', 'all', 'any']
  }

  const platformAliases = {
    darwin: ['darwin', 'macos', 'mac', 'osx', 'apple'],
    linux: ['linux', 'gnu'],
    win32: ['win32', 'win', 'windows', 'win64']
  }

  const myArch = [arch, ...(archAliases[arch] || []), ...archAliases.universal]
  const myPlatform = [platform, ...(platformAliases[platform] || [])]

  return {
    arch,
    platform,
    archAliases,
    platformAliases,
    myArch,
    myPlatform
  }
}

module.exports = {
  SOURCE_TYPES,
  URL_TYPES,
  PHASES,
  createSource,
  createPlatformInfo
}
