const { Module } = require('../../core/module')
const { URL_TYPES } = require('../../core/types')
const { getExtension, isInstallable } = require('../../extensions')

class LinkParserModule extends Module {
  static name = 'LinkParser'
  static phase = 'detect'
  static priority = 50
  static dependencies = []

  async shouldRun() {
    if (this.context.urlType !== null) return false
    
    const input = this.context.originalInput
    if (!input || typeof input !== 'string') return false
    
    return input.startsWith('http://') || input.startsWith('https://')
  }

  async run() {
    const url = this.context.originalInput
    
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const filename = pathname.split('/').pop() || ''
      const extension = getExtension(filename)
      
      if (extension && isInstallable(extension)) {
        this.context.urlType = URL_TYPES.DIRECT
        this.context.directLink = {
          url,
          filename,
          extension
        }
        this.debug(`Detected direct download: ${filename} (${extension})`)
      } else {
        this.context.urlType = URL_TYPES.WEBSITE
        this.debug(`URL appears to be a website, will scrape: ${url}`)
      }
    } catch (error) {
      this.context.urlType = URL_TYPES.WEBSITE
      this.debug(`Failed to parse URL, treating as website: ${url}`)
    }
  }
}

module.exports = { LinkParserModule }
