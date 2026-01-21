const fs = require('fs')
const path = require('path')
const { Module } = require('../../core/module')

class DownloaderModule extends Module {
  static name = 'Downloader'
  static phase = 'download'
  static priority = 100
  static dependencies = ['AssetSelector']

  async shouldRun() {
    const source = this.context.selectedSource
    if (!source) return false
    if (source.type === 'script') return false
    if (source.localPath) return false
    return source.url !== null
  }

  async run() {
    const source = this.context.selectedSource
    const tmpdir = this.context.createTmpDir()
    const destPath = path.join(tmpdir, source.name)
    
    this.debug(`Downloading ${source.name} to ${destPath}`)
    
    await this._download(source.url, destPath, source.size)
    
    this.context.downloadPath = destPath
    source.localPath = destPath
    
    this.debug(`Download complete: ${destPath}`)
  }

  async _download(url, destPath, expectedSize = null) {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'justinstall'
      }
    })
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }
    
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
    const totalSize = contentLength || expectedSize || 0
    
    const reader = response.body.getReader()
    const chunks = []
    let downloaded = 0
    
    const startTime = Date.now()
    let lastProgressUpdate = startTime
    
    while (true) {
      const { done, value } = await reader.read()
      
      if (done) break
      
      chunks.push(value)
      downloaded += value.length
      
      const now = Date.now()
      if (now - lastProgressUpdate > 500 && totalSize > 0) {
        const percent = Math.round((downloaded / totalSize) * 100)
        const elapsed = (now - startTime) / 1000
        const rate = downloaded / elapsed
        const remaining = (totalSize - downloaded) / rate
        
        process.stdout.write(`\r  Downloading: ${percent}% (${this._formatSize(downloaded)}/${this._formatSize(totalSize)}) - ${this._formatTime(remaining)} remaining`)
        lastProgressUpdate = now
      }
    }
    
    if (totalSize > 0) {
      process.stdout.write('\r' + ' '.repeat(80) + '\r')
    }
    
    const buffer = Buffer.concat(chunks)
    fs.writeFileSync(destPath, buffer)
  }

  _formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  _formatTime(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
  }
}

module.exports = { DownloaderModule }
