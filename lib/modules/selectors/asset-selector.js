const { Module } = require('../../core/module')

class AssetSelectorModule extends Module {
  static name = 'AssetSelector'
  static phase = 'select'
  static priority = 100
  static dependencies = []

  async shouldRun() {
    return this.context.sources.length > 0 && this.context.selectedSource === null
  }

  async run() {
    const compatible = this.context.getCompatibleSources()
    
    if (compatible.length === 0) {
      throw new Error('No compatible sources found after filtering')
    }
    
    const top = compatible[0]
    this.context.selectedSource = top
    
    this.debug(`Selected source: ${top.name} (priority: ${top.priority}, type: ${top.type})`)
    
    if (compatible.length > 1) {
      this.debug(`Other options: ${compatible.slice(1, 4).map(s => s.name).join(', ')}`)
    }
  }
}

module.exports = { AssetSelectorModule }
