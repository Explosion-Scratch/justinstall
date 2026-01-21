const { Module } = require('../../core/module')

class GitHubSearchModule extends Module {
  static name = 'GitHubSearch'
  static phase = 'utility'
  static priority = 100
  static capabilities = {
    search: true,
    serialize: false,
    updates: false
  }

  async shouldRun() { return false }

  canSearch() { return true }

  async search(query) {
    const repos = await this._searchGitHub(query)
    
    return repos.map((repo, index) => ({
      id: `github:${repo.full_name}`,
      name: repo.full_name,
      displayName: repo.full_name,
      description: repo.description || 'No description',
      score: this._calculateScore(repo, index),
      metadata: {
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        url: repo.html_url,
        owner: repo.owner.login,
        repo: repo.name,
        language: repo.language,
        license: repo.license?.spdx_id
      },
      installArgs: [repo.full_name],
      module: this.constructor.name,
      provider: 'GitHub'
    }))
  }

  formatResult(result, index) {
    const stars = result.metadata.stars
    const starsStr = stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : stars
    const lang = result.metadata.language ? ` [${result.metadata.language}]` : ''
    
    return [
      `${index + 1}. ${result.displayName} (⭐ ${starsStr})${lang}`,
      `   ${result.description}`
    ].join('\n')
  }

  _calculateScore(repo, position) {
    let score = 1000 - (position * 10)
    
    score += Math.min(repo.stargazers_count / 100, 500)
    
    if (repo.license) score += 20
    if (repo.description) score += 10
    
    return Math.round(score)
  }

  async _searchGitHub(query) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=20`
    
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'justinstall'
    }
    
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`
    }
    
    const response = await fetch(url, { headers })
    
    if (!response.ok) {
      throw new Error(`GitHub search failed: ${response.status}`)
    }
    
    const data = await response.json()
    return data.items || []
  }
}

module.exports = { GitHubSearchModule }
