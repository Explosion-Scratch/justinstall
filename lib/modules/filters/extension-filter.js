const { Module } = require('../../core/module')
const { isInstallable, isExtensionSupported } = require('../../extensions')

class ExtensionFilterModule extends Module {
  static name = 'ExtensionFilter'
  static phase = 'filter'
  static priority = 90
  static dependencies = []

  async shouldRun() {
    return this.context.sources.length > 0
  }

  async run() {
    const { platform } = this.context.platform
    const capabilities = this.context.capabilities
    let filtered = 0
    
    for (const source of this.context.sources) {
      if (source.type === 'script') continue
      if (source.priority < 0) continue
      
      const ext = source.extension
      
      if (!ext) continue
      
      if (!isInstallable(ext)) {
        source.priority = -1
        filtered++
        continue
      }
      
      if (!isExtensionSupported(ext, platform, capabilities)) {
        source.priority = -1
        filtered++
        continue
      }
    }
    
    this.context.sources = this.context.sources.filter(s => s.priority >= 0)
    this.debug(`Filtered ${filtered} sources with unsupported extensions`)
  }
}

module.exports = { ExtensionFilterModule }
