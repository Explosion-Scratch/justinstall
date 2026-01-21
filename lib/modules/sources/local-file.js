const { Module } = require('../../core/module')
const { createSource, SOURCE_TYPES } = require('../../core/types')

class LocalFileModule extends Module {
  static name = 'LocalFile'
  static phase = 'source'
  static priority = 60
  static dependencies = ['LocalFileDetector']

  async shouldRun() {
    return this.context.urlType === 'file' && this.context.localFile !== null
  }

  async run() {
    const { path, filename, extension, size } = this.context.localFile
    
    const source = createSource({
      url: null,
      localPath: path,
      type: SOURCE_TYPES.ASSET,
      name: filename,
      size,
      extension,
      priority: 700,
      confidence: 100,
      module: this.constructor.name
    })
    
    this.context.addSource(source)
    this.debug(`Added local file source: ${filename}`)
  }
}

module.exports = { LocalFileModule }
