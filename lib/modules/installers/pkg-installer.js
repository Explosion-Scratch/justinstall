const { Module } = require('../../core/module')
const { safeExecSync } = require('../../utils')

class PKGInstallerModule extends Module {
  static name = 'PKGInstaller'
  static phase = 'install'
  static priority = 85
  static dependencies = []

  async shouldRun() {
    const source = this.context.selectedSource
    if (!source || source.type === 'script') return false
    return source.extension === 'pkg'
  }

  async run() {
    const source = this.context.selectedSource
    const pkgPath = source.localPath || this.context.downloadPath
    
    this.log(`Installing PKG: ${source.name}`)
    safeExecSync('sudo', ['installer', '-pkg', pkgPath, '-target', '/'])
    
    this.context.installedName = source.name.replace(/\.pkg$/i, '')
    
    this.context.installResult = {
      method: 'pkg',
      destinations: ['System-wide package installation'],
      binaries: [source.name]
    }
    
    this.log(`Successfully installed ${source.name}`)
  }
}

module.exports = { PKGInstallerModule }
