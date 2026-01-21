const { Module } = require('../../core/module')
const { createSource, SOURCE_TYPES } = require('../../core/types')
const { getExtension } = require('../../extensions')

class GitHubReleasesModule extends Module {
  static name = 'GitHubReleases'
  static phase = 'source'
  static priority = 100
  static dependencies = ['GitHubDetector']

  async shouldRun() {
    return this.context.urlType === 'github' && this.context.github !== null
  }

  async run() {
    const { owner, repo, tag } = this.context.github
    
    try {
      const releaseData = await this._fetchRelease(owner, repo, tag)
      
      this.context.github.releaseInfo = {
        tag: releaseData.tag_name,
        name: releaseData.name,
        body: releaseData.body || '',
        prerelease: releaseData.prerelease,
        published_at: releaseData.published_at
      }
      
      const assets = releaseData.assets || []
      this.debug(`Found ${assets.length} assets in release ${releaseData.tag_name}`)
      
      for (const asset of assets) {
        const extension = getExtension(asset.name)
        const priority = this._calculatePriority(asset, extension)
        
        const source = createSource({
          url: asset.browser_download_url,
          type: SOURCE_TYPES.ASSET,
          name: asset.name,
          size: asset.size,
          extension,
          priority,
          confidence: 80,
          module: this.constructor.name,
          prerelease: releaseData.prerelease
        })
        
        this.context.addSource(source)
      }
      
      if (releaseData.prerelease) {
        this.warn(`Using prerelease version: ${releaseData.tag_name}`)
      }
    } catch (error) {
      if (error.message.includes('No releases found')) {
        this.debug('No releases found, will try other sources')
      } else {
        throw error
      }
    }
  }

  async _fetchRelease(owner, repo, specificTag) {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'justinstall'
    }
    
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`
    }
    
    let url
    if (specificTag) {
      url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${specificTag}`
    } else {
      url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`
    }
    
    let response = await fetch(url, { headers })
    
    if (response.status === 404 && !specificTag) {
      const allReleasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases`
      response = await fetch(allReleasesUrl, { headers })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch releases: ${response.status}`)
      }
      
      const releases = await response.json()
      
      if (!Array.isArray(releases) || releases.length === 0) {
        throw new Error('No releases found in GitHub repository')
      }
      
      const stable = releases.find(r => !r.prerelease && !r.draft)
      return stable || releases[0]
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch release: ${response.status}`)
    }
    
    return response.json()
  }

  _calculatePriority(asset, extension) {
    let priority = 400
    
    const platformPackages = {
      darwin: ['dmg', 'pkg', 'app'],
      linux: ['deb', 'rpm', 'AppImage'],
      win32: ['exe', 'msi']
    }
    
    const myPlatform = this.context.platform.platform
    const preferredExts = platformPackages[myPlatform] || []
    
    if (preferredExts.includes(extension)) {
      priority += 100
    }
    
    if (['tar.gz', 'zip', 'tar.xz'].includes(extension)) {
      priority += 50
    }
    
    if (!extension) {
      priority += 80
    }
    
    return priority
  }
}

module.exports = { GitHubReleasesModule }
