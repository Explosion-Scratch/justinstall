const { ModuleRegistry } = require('../core/registry')

const { GitHubDetectorModule, LinkParserModule, LocalFileDetectorModule } = require('./detectors')
const { GitHubReleasesModule, GitHubReadmeModule, DirectDownloadModule, WebScraperModule, LocalFileModule } = require('./sources')
const { ArchFilterModule, ExtensionFilterModule, CapabilityFilterModule, PreReleaseFilterModule } = require('./filters')
const { AssetSelectorModule, UserConfirmationModule } = require('./selectors')
const { DownloaderModule } = require('./downloaders')
const { ScriptInstallerModule, DMGInstallerModule, PKGInstallerModule, DEBInstallerModule, ArchiveInstallerModule, BinaryInstallerModule } = require('./installers')
const { GitHubSearchModule, GitHubSerializerModule } = require('./utilities')

function loadModules() {
  const registry = new ModuleRegistry()
  
  registry.registerAll([
    GitHubDetectorModule,
    LinkParserModule,
    LocalFileDetectorModule
  ])
  
  registry.registerAll([
    GitHubReleasesModule,
    GitHubReadmeModule,
    DirectDownloadModule,
    WebScraperModule,
    LocalFileModule
  ])
  
  registry.registerAll([
    ArchFilterModule,
    ExtensionFilterModule,
    CapabilityFilterModule,
    PreReleaseFilterModule
  ])
  
  registry.registerAll([
    AssetSelectorModule,
    UserConfirmationModule
  ])
  
  registry.registerAll([
    DownloaderModule
  ])
  
  registry.registerAll([
    ScriptInstallerModule,
    DMGInstallerModule,
    PKGInstallerModule,
    DEBInstallerModule,
    ArchiveInstallerModule,
    BinaryInstallerModule
  ])
  
  registry.registerAll([
    GitHubSearchModule,
    GitHubSerializerModule
  ])
  
  return registry
}

function getSearchProviders(registry) {
  return [...registry.modules.values()].filter(M => M.capabilities?.search)
}

function getSerializers(registry) {
  return [...registry.modules.values()].filter(M => M.capabilities?.serialize)
}

function getUpdateCheckers(registry) {
  return [...registry.modules.values()].filter(M => M.capabilities?.updates)
}

module.exports = {
  loadModules,
  getSearchProviders,
  getSerializers,
  getUpdateCheckers,
  
  GitHubDetectorModule,
  LinkParserModule,
  LocalFileDetectorModule,
  
  GitHubReleasesModule,
  GitHubReadmeModule,
  DirectDownloadModule,
  WebScraperModule,
  LocalFileModule,
  
  ArchFilterModule,
  ExtensionFilterModule,
  CapabilityFilterModule,
  PreReleaseFilterModule,
  
  AssetSelectorModule,
  UserConfirmationModule,
  
  DownloaderModule,
  
  ScriptInstallerModule,
  DMGInstallerModule,
  PKGInstallerModule,
  DEBInstallerModule,
  ArchiveInstallerModule,
  BinaryInstallerModule,
  
  GitHubSearchModule,
  GitHubSerializerModule
}
