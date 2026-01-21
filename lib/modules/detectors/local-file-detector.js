const fs = require('fs')
const path = require('path')
const { Module } = require('../../core/module')
const { URL_TYPES } = require('../../core/types')
const { getExtension } = require('../../extensions')

class LocalFileDetectorModule extends Module {
  static name = 'LocalFileDetector'
  static phase = 'detect'
  static priority = 40
  static dependencies = []

  async shouldRun() {
    if (this.context.urlType !== null) return false
    
    const input = this.context.originalInput
    if (!input || typeof input !== 'string') return false
    
    if (input.startsWith('http://') || input.startsWith('https://')) return false
    
    const resolved = this._resolvePath(input)
    return fs.existsSync(resolved)
  }

  async run() {
    const input = this.context.originalInput
    const resolved = this._resolvePath(input)
    
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`)
    }
    
    const stats = fs.statSync(resolved)
    const filename = path.basename(resolved)
    const extension = getExtension(filename)
    
    this.context.urlType = URL_TYPES.FILE
    this.context.localFile = {
      path: resolved,
      filename,
      extension,
      size: stats.size
    }
    
    this.debug(`Detected local file: ${filename} (${extension})`)
  }

  _resolvePath(input) {
    if (path.isAbsolute(input)) {
      return input
    }
    return path.resolve(process.cwd(), input)
  }
}

module.exports = { LocalFileDetectorModule }
