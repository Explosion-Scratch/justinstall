const { Module } = require('../../core/module')
const { createSource, SOURCE_TYPES } = require('../../core/types')

class DirectDownloadModule extends Module {
  static name = 'DirectDownload'
  static phase = 'source'
  static priority = 80
  static dependencies = ['LinkParser']

  async shouldRun() {
    return this.context.urlType === 'direct' && this.context.directLink !== null
  }

  async run() {
    const { url, filename, extension } = this.context.directLink
    
    const source = createSource({
      url,
      type: SOURCE_TYPES.ASSET,
      name: filename,
      extension,
      priority: 600,
      confidence: 95,
      module: this.constructor.name
    })
    
    this.context.addSource(source)
    this.debug(`Added direct download source: ${filename}`)
  }
}

module.exports = { DirectDownloadModule }
