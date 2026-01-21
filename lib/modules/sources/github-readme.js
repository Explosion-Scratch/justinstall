const { Module } = require('../../core/module')
const { createSource, SOURCE_TYPES } = require('../../core/types')

class GitHubReadmeModule extends Module {
  static name = 'GitHubReadme'
  static phase = 'source'
  static priority = 90
  static dependencies = ['GitHubDetector']

  static INSTALL_PATTERNS = [
    { pattern: /curl\s+.*\|\s*(?:ba)?sh/i, score: 90, type: 'curl_pipe' },
    { pattern: /wget\s+.*\|\s*(?:ba)?sh/i, score: 90, type: 'wget_pipe' },
    { pattern: /curl\s+-[fsSL]+\s+.*install/i, score: 85, type: 'curl_install' },
    { pattern: /brew\s+install\s+\S+/i, score: 40, type: 'brew' },
    { pattern: /pip\s+install\s+\S+/i, score: 35, type: 'pip' },
    { pattern: /npm\s+install\s+-g\s+\S+/i, score: 35, type: 'npm' },
    { pattern: /cargo\s+install\s+\S+/i, score: 50, type: 'cargo' },
    { pattern: /go\s+install\s+\S+/i, score: 45, type: 'go' }
  ]

  async shouldRun() {
    return this.context.urlType === 'github' && this.context.github !== null
  }

  async run() {
    const { owner, repo } = this.context.github
    const body = this.context.github.releaseInfo?.body || ''
    
    const scripts = await this._findInstallScripts(owner, repo, body)
    
    this.debug(`Found ${scripts.length} install scripts`)
    
    for (const script of scripts) {
      const priority = this._calculatePriority(script.score, script.type)
      
      const source = createSource({
        type: SOURCE_TYPES.SCRIPT,
        name: `Install script from ${script.source}`,
        code: script.code,
        scriptSource: script.source,
        priority,
        confidence: script.score,
        module: this.constructor.name
      })
      
      this.context.addSource(source)
    }
  }

  async _findInstallScripts(owner, repo, releaseBody) {
    const scripts = []
    
    if (releaseBody) {
      const releaseScripts = this._extractScriptsFromMarkdown(releaseBody, 'release_notes')
      scripts.push(...releaseScripts)
    }
    
    const readme = await this._fetchReadme(owner, repo)
    if (readme) {
      const readmeScripts = this._extractScriptsFromMarkdown(readme, 'readme')
      scripts.push(...readmeScripts)
    }
    
    const seen = new Set()
    return scripts.filter(s => {
      const key = s.code.trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).sort((a, b) => b.score - a.score)
  }

  async _fetchReadme(owner, repo) {
    const branches = ['main', 'master']
    
    for (const branch of branches) {
      try {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`
        const response = await fetch(url)
        if (response.ok) {
          return response.text()
        }
      } catch {
      }
    }
    
    return null
  }

  _extractScriptsFromMarkdown(markdown, source) {
    const scripts = []
    
    const codeBlockRegex = /```(?:bash|sh|shell|zsh)?\n([\s\S]*?)```/g
    let match
    
    while ((match = codeBlockRegex.exec(markdown)) !== null) {
      const code = match[1].trim()
      const scoreInfo = this._scoreScript(code)
      
      if (scoreInfo.score > 0) {
        scripts.push({
          code,
          source,
          score: scoreInfo.score,
          type: scoreInfo.type
        })
      }
    }
    
    return scripts
  }

  _scoreScript(code) {
    if (!code || code.length < 10 || code.length > 2000) {
      return { score: 0, type: null }
    }
    
    const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
    if (lines.length > 10) {
      return { score: 0, type: null }
    }
    
    for (const { pattern, score, type } of GitHubReadmeModule.INSTALL_PATTERNS) {
      if (pattern.test(code)) {
        return { score, type }
      }
    }
    
    return { score: 0, type: null }
  }

  _calculatePriority(score, type) {
    if (score >= 80 && (type === 'curl_pipe' || type === 'wget_pipe')) {
      return 1000
    }
    
    if (score >= 50) {
      return 500
    }
    
    return 200
  }
}

module.exports = { GitHubReadmeModule }
