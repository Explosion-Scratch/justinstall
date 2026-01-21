const { ScriptInstallerModule } = require('./script-installer')
const { ShellScriptInstallerModule } = require('./shell-script-installer')
const { DMGInstallerModule } = require('./dmg-installer')
const { PKGInstallerModule } = require('./pkg-installer')
const { DEBInstallerModule } = require('./deb-installer')
const { ArchiveInstallerModule } = require('./archive-installer')
const { BinaryInstallerModule } = require('./binary-installer')

module.exports = {
  ScriptInstallerModule,
  ShellScriptInstallerModule,
  DMGInstallerModule,
  PKGInstallerModule,
  DEBInstallerModule,
  ArchiveInstallerModule,
  BinaryInstallerModule
}
