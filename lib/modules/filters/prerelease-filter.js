const { Module } = require('../../core/module')

class PreReleaseFilterModule extends Module {
  static name = 'PreReleaseFilter'
  static phase = 'filter'
  static priority = 70
  static dependencies = []

  async shouldRun() {
    return this.context.sources.length > 0
  }

  async run() {
    const hasStable = this.context.sources.some(s => !s.prerelease && s.priority >= 0)
    
    if (!hasStable) {
      this.debug('No stable releases found, keeping prereleases at current priority')
      return
    }
    
    let deprioritized = 0
    
    for (const source of this.context.sources) {
      if (source.prerelease && source.priority >= 0) {
        source.priority -= 100
        deprioritized++
      }
    }
    
    this.context._sortSources()
    
    if (deprioritized > 0) {
      this.debug(`Deprioritized ${deprioritized} prerelease sources`)
    }
  }
}

module.exports = { PreReleaseFilterModule }
