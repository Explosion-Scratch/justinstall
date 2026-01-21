const { Module } = require('../../core/module')
const { createSource, SOURCE_TYPES } = require('../../core/types')
const { getExtension, isInstallable } = require('../../extensions')

class WebScraperModule extends Module {
  static name = 'WebScraper'
  static phase = 'source'
  static priority = 70
  static dependencies = ['LinkParser']

  async shouldRun() {
    return this.context.urlType === 'website'
  }

  async run() {
    const url = this.context.originalInput
    
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }
      
      const contentType = response.headers.get('content-type') || ''
      
      if (!contentType.includes('text/html')) {
        const filename = url.split('/').pop() || 'download'
        const extension = getExtension(filename)
        
        this.context.directLink = { url, filename, extension }
        
        const source = createSource({
          url,
          type: SOURCE_TYPES.ASSET,
          name: filename,
          extension,
          priority: 600,
          confidence: 90,
          module: this.constructor.name
        })
        this.context.addSource(source)
        return
      }
      
      const html = await response.text()
      const assets = this._scrapeLinks(html, url)
      
      this.debug(`Found ${assets.length} potential assets from HTML`)
      
      for (const asset of assets) {
        this.context.addSource(asset)
      }
    } catch (error) {
      this.warn(`Failed to scrape ${url}: ${error.message}`)
    }
  }

  _scrapeLinks(html, baseUrl) {
    const assets = []
    const linkRegex = /href=["']([^"']+)["']/gi
    const baseUrlObj = new URL(baseUrl)
    
    let match
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1]
      
      try {
        const absoluteUrl = new URL(href, baseUrl).href
        const filename = absoluteUrl.split('/').pop().split('?')[0]
        const extension = getExtension(filename)
        
        if (extension && isInstallable(extension)) {
          const priority = this._calculatePriority(extension, filename)
          
          assets.push(createSource({
            url: absoluteUrl,
            type: SOURCE_TYPES.ASSET,
            name: filename,
            extension,
            priority,
            confidence: 60,
            module: this.constructor.name
          }))
        }
      } catch {
      }
    }
    
    const seen = new Set()
    return assets.filter(a => {
      if (seen.has(a.url)) return false
      seen.add(a.url)
      return true
    })
  }

  _calculatePriority(extension, filename) {
    let priority = 300
    
    const platformPackages = {
      darwin: ['dmg', 'pkg'],
      linux: ['deb', 'rpm', 'AppImage'],
      win32: ['exe', 'msi']
    }
    
    const myPlatform = this.context.platform.platform
    const preferred = platformPackages[myPlatform] || []
    
    if (preferred.includes(extension)) {
      priority += 100
    }
    
    return priority
  }
}

module.exports = { WebScraperModule }
