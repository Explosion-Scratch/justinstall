const fs = require('fs')
const path = require('path')
const os = require('os')
const { createPlatformInfo, URL_TYPES } = require('./types')
const { safeExecSync } = require('../utils')

class ModuleContext {
  constructor(sourceInput, options = {}) {
    this.originalInput = sourceInput
    this.options = options
    
    this.platform = createPlatformInfo()
    this.capabilities = this._detectCapabilities()

    this.urlType = null
    
    this.github = null
    this.gitlab = null
    this.directLink = null
    this.localFile = null

    this.sources = []
    this.selectedSource = null

    this.tmpdir = null
    this.downloadPath = null
    this.extractedDir = null

    this.installResult = null
    this.version = null
    this.installedName = null
  }

  _detectCapabilities() {
    const ebool = (cmd) => {
      try {
        return safeExecSync(cmd, [], { stdio: 'ignore' }).length > 0
      } catch {
        return false
      }
    }

    return {
      dmg: process.platform === 'darwin',
      pkg: process.platform === 'darwin',
      app: process.platform === 'darwin',
      deb: process.platform === 'linux' && ebool('which dpkg'),
      rpm: process.platform === 'linux' && ebool('which rpm'),
      'tar.zst': ebool('which unzstd') || ebool('which zstd')
    }
  }

  addSource(sourceData) {
    this.sources.push(sourceData)
    this._sortSources()
  }

  _sortSources() {
    this.sources.sort((a, b) => b.priority - a.priority)
  }

  getCompatibleSources() {
    return this.sources.filter(s => s.archCompatible && s.platformCompatible && s.priority >= 0)
  }

  getTopSource() {
    const compatible = this.getCompatibleSources()
    return compatible.length > 0 ? compatible[0] : null
  }

  createTmpDir() {
    if (!this.tmpdir) {
      this.tmpdir = safeExecSync('mktemp', ['-d'], { encoding: 'utf8' }).trim()
    }
    return this.tmpdir
  }

  cleanup() {
    if (this.tmpdir && fs.existsSync(this.tmpdir)) {
      try {
        fs.rmSync(this.tmpdir, { recursive: true, force: true })
      } catch {
      }
    }
  }
}

module.exports = { ModuleContext }
