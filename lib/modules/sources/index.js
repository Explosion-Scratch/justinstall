const { GitHubReleasesModule } = require('./github-releases')
const { GitHubReadmeModule } = require('./github-readme')
const { DirectDownloadModule } = require('./direct-download')
const { WebScraperModule } = require('./web-scraper')
const { LocalFileModule } = require('./local-file')

module.exports = {
  GitHubReleasesModule,
  GitHubReadmeModule,
  DirectDownloadModule,
  WebScraperModule,
  LocalFileModule
}
