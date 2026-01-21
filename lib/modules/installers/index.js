const { ScriptInstallerModule } = require('./script-installer')
const { DMGInstallerModule } = require('./dmg-installer')
const { PKGInstallerModule } = require('./pkg-installer')
const { DEBInstallerModule } = require('./deb-installer')
const { ArchiveInstallerModule } = require('./archive-installer')
const { BinaryInstallerModule } = require('./binary-installer')

module.exports = {
  ScriptInstallerModule,
  DMGInstallerModule,
  PKGInstallerModule,
  DEBInstallerModule,
  ArchiveInstallerModule,
  BinaryInstallerModule
}
