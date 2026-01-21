const { ArchFilterModule } = require('./arch-filter')
const { ExtensionFilterModule } = require('./extension-filter')
const { CapabilityFilterModule } = require('./capability-filter')
const { PreReleaseFilterModule } = require('./prerelease-filter')

module.exports = {
  ArchFilterModule,
  ExtensionFilterModule,
  CapabilityFilterModule,
  PreReleaseFilterModule
}
