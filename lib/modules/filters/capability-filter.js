const { Module } = require('../../core/module')

class CapabilityFilterModule extends Module {
  static name = 'CapabilityFilter'
  static phase = 'filter'
  static priority = 80
  static dependencies = []

  async shouldRun() {
    return this.context.sources.length > 0
  }

  async run() {
    const capabilities = this.context.capabilities
    let filtered = 0
    
    for (const source of this.context.sources) {
      if (source.type === 'script') continue
      if (source.priority < 0) continue
      
      const ext = source.extension
      if (!ext) continue
      
      if (capabilities[ext] === false) {
        source.priority = -1
        filtered++
        this.debug(`Filtered ${source.name}: capability ${ext} not available`)
      }
    }
    
    this.context.sources = this.context.sources.filter(s => s.priority >= 0)
    
    if (filtered > 0) {
      this.debug(`Filtered ${filtered} sources due to missing capabilities`)
    }
  }
}

module.exports = { CapabilityFilterModule }
