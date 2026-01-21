const { Module } = require('../../core/module')
const { hashFile, extractName } = require('../../config')

class GitHubSerializerModule extends Module {
  static name = 'GitHubSerializer'
  static phase = 'utility'
  static priority = 100
  static capabilities = {
    search: false,
    serialize: true,
    updates: true
  }

  async shouldRun() { return false }

  canSerialize() { return true }
  canCheckUpdates() { return true }

  matchesRecord(record) {
    return record?.source?.type === 'github'
  }

  serialize(context) {
    if (context.urlType !== 'github') return null
    
    const source = context.selectedSource || {}
    const downloadPath = context.downloadPath
    
    return {
      name: context.installedName || extractName(source),
      date: new Date().toISOString(),
      source: {
        type: 'github',
        url: context.originalInput,
        owner: context.github?.owner,
        repo: context.github?.repo,
        originalArgs: context.originalInput
      },
      selected: {
        name: source.name,
        size: source.size,
        extension: source.extension,
        downloadUrl: source.url,
        hash: downloadPath ? hashFile(downloadPath) : null
      },
      installation: {
        method: context.installResult?.method,
        binaries: context.installResult?.binaries || [],
        destinations: context.installResult?.destinations || []
      },
      version: context.github?.releaseInfo?.tag || context.version,
      commit: context.github?.releaseInfo?.commit,
      prerelease: context.github?.releaseInfo?.prerelease
    }
  }

  deserialize(record) {
    if (!this.matchesRecord(record)) return null
    
    return {
      owner: record.source?.owner,
      repo: record.source?.repo,
      version: record.version,
      commit: record.commit,
      installMethod: record.installation?.method,
      binaries: record.installation?.binaries,
      destinations: record.installation?.destinations
    }
  }

  async checkForUpdates(record) {
    if (!this.matchesRecord(record)) {
      return { hasUpdate: false, canUpdate: false, reason: 'Not a GitHub installation' }
    }
    
    const { owner, repo } = record.source
    const currentVersion = record.version
    
    if (!owner || !repo) {
      return { hasUpdate: undefined, canUpdate: false, error: true, reason: 'Missing owner/repo' }
    }
    
    try {
      const latestRelease = await this._fetchLatestRelease(owner, repo)
      
      if (!latestRelease) {
        return { hasUpdate: undefined, canUpdate: false, error: true, reason: 'Could not fetch latest release' }
      }
      
      const latestVersion = latestRelease.tag_name
      
      if (latestVersion === currentVersion) {
        return { hasUpdate: false, canUpdate: false, reason: 'Already up to date' }
      }
      
      return {
        hasUpdate: true,
        canUpdate: true,
        currentVersion,
        latestVersion,
        reason: `${currentVersion} → ${latestVersion}`,
        source: record.source,
        name: record.name
      }
    } catch (error) {
      return { hasUpdate: undefined, canUpdate: false, error: true, reason: error.message }
    }
  }

  async _fetchLatestRelease(owner, repo) {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'justinstall'
    }
    
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`
    }
    
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers })
    
    if (response.status === 404) {
      const allResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, { headers })
      if (!allResponse.ok) return null
      const releases = await allResponse.json()
      return releases[0] || null
    }
    
    if (!response.ok) return null
    return response.json()
  }
}

module.exports = { GitHubSerializerModule }
