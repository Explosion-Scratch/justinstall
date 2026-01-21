const { Module } = require('../../core/module')
const { URL_TYPES } = require('../../core/types')

class GitHubDetectorModule extends Module {
  static name = 'GitHubDetector'
  static phase = 'detect'
  static priority = 100
  static dependencies = []

  async shouldRun() {
    const input = this.context.originalInput
    if (!input || typeof input !== 'string') return false
    
    if (input.includes('github.com')) return true
    if (/^[\w.-]+\/[\w.-]+$/.test(input)) return true
    
    return false
  }

  async run() {
    const input = this.context.originalInput
    const parsed = this._parseGitHubInput(input)
    
    if (!parsed) {
      throw new Error(`Failed to parse GitHub input: ${input}`)
    }
    
    this.context.urlType = URL_TYPES.GITHUB
    this.context.github = {
      owner: parsed.owner,
      repo: parsed.repo,
      tag: parsed.tag,
      apiUrl: `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
      releasesUrl: `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases`,
      releaseInfo: null
    }
    
    this.debug(`Detected GitHub repo: ${parsed.owner}/${parsed.repo}${parsed.tag ? ` @ ${parsed.tag}` : ''}`)
  }

  _parseGitHubInput(input) {
    if (input.includes('github.com')) {
      return this._parseGitHubUrl(input)
    }
    
    return this._parseShorthand(input)
  }

  _parseGitHubUrl(url) {
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
      const pathParts = urlObj.pathname.split('/').filter(Boolean)
      
      if (pathParts.length < 2) return null
      
      const owner = pathParts[0]
      const repo = pathParts[1].replace(/\.git$/, '')
      let tag = null
      
      if (pathParts[2] === 'releases' && pathParts[3] === 'tag' && pathParts[4]) {
        tag = pathParts[4]
      } else if (pathParts[2] === 'releases' && pathParts[3] === 'download' && pathParts[4]) {
        tag = pathParts[4]
      } else if (pathParts[2] === 'tree' && pathParts[3]) {
        tag = pathParts[3]
      }
      
      return { owner, repo, tag }
    } catch {
      return null
    }
  }

  _parseShorthand(input) {
    const match = input.match(/^([\w.-]+)\/([\w.-]+)(?:@(.+))?$/)
    if (!match) return null
    
    return {
      owner: match[1],
      repo: match[2],
      tag: match[3] || null
    }
  }
}

module.exports = { GitHubDetectorModule }
