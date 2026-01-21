const { Module } = require('../../core/module')

class ArchFilterModule extends Module {
  static name = 'ArchFilter'
  static phase = 'filter'
  static priority = 100
  static dependencies = []

  static INCOMPATIBLE_PLATFORMS = {
    darwin: ['linux', 'win', 'windows', 'win32', 'win64', 'ubuntu', 'debian', 'fedora', 'centos'],
    linux: ['darwin', 'macos', 'mac', 'osx', 'win', 'windows', 'win32', 'win64'],
    win32: ['darwin', 'macos', 'mac', 'osx', 'linux', 'ubuntu', 'debian', 'fedora']
  }

  static INCOMPATIBLE_ARCH = {
    arm64: ['x86', 'x64', 'amd64', 'x86_64', 'i386', 'i686', '386', 'x86-64'],
    x64: ['arm64', 'aarch64', 'arm', 'm1', 'm2', 'm3', 'm4', 'apple-silicon', 'silicon']
  }

  async shouldRun() {
    return this.context.sources.length > 0
  }

  async run() {
    const { platform, arch } = this.context.platform
    let filtered = 0
    let boosted = 0
    
    for (const source of this.context.sources) {
      if (source.type === 'script') {
        source.archCompatible = true
        source.platformCompatible = true
        continue
      }
      
      const segments = this._tokenize(source.name)
      
      source.platformCompatible = this._checkPlatformCompatibility(segments, platform)
      if (!source.platformCompatible) {
        source.priority = -1
        filtered++
        continue
      }
      
      source.archCompatible = this._checkArchCompatibility(segments, arch)
      if (!source.archCompatible) {
        source.priority = -1
        filtered++
        continue
      }
      
      const boost = this._calculateArchBoost(segments, platform, arch)
      if (boost > 0) {
        source.priority += boost
        source.archScore = boost
        boosted++
      }
    }
    
    this.context.sources = this.context.sources.filter(s => s.priority >= 0)
    
    this.debug(`Filtered ${filtered} incompatible sources, boosted ${boosted} matching sources`)
  }

  _tokenize(name) {
    return name
      .toLowerCase()
      .replace(/[._-]+/g, ' ')
      .split(' ')
      .filter(Boolean)
  }

  _checkPlatformCompatibility(segments, platform) {
    const incompatible = ArchFilterModule.INCOMPATIBLE_PLATFORMS[platform] || []
    return !segments.some(s => incompatible.includes(s))
  }

  _checkArchCompatibility(segments, arch) {
    if (segments.includes('universal') || segments.includes('all') || segments.includes('any')) {
      return true
    }
    
    const incompatible = ArchFilterModule.INCOMPATIBLE_ARCH[arch] || []
    return !segments.some(s => incompatible.includes(s))
  }

  _calculateArchBoost(segments, platform, arch) {
    let boost = 0
    
    const platformAliases = this.context.platform.platformAliases[platform] || []
    if (segments.some(s => platformAliases.includes(s))) {
      boost += 15
    }
    
    const archAliases = this.context.platform.archAliases[arch] || []
    if (segments.some(s => archAliases.includes(s))) {
      boost += 10
    }
    
    if (segments.includes('universal')) {
      boost += 5
    }
    
    return boost
  }
}

module.exports = { ArchFilterModule }
