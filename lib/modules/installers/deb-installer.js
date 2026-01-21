const { Module } = require('../../core/module')
const { safeExecSync } = require('../../utils')

class DEBInstallerModule extends Module {
  static name = 'DEBInstaller'
  static phase = 'install'
  static priority = 80
  static dependencies = []

  async shouldRun() {
    const source = this.context.selectedSource
    if (!source || source.type === 'script') return false
    return source.extension === 'deb'
  }

  async run() {
    const source = this.context.selectedSource
    const debPath = source.localPath || this.context.downloadPath
    
    this.log(`Installing DEB package: ${source.name}`)
    safeExecSync('sudo', ['dpkg', '-i', debPath])
    
    this.context.installedName = source.name.replace(/\.deb$/i, '')
    
    this.context.installResult = {
      method: 'deb',
      destinations: ['System-wide deb installation'],
      binaries: [source.name]
    }
    
    this.log(`Successfully installed ${source.name}`)
  }
}

module.exports = { DEBInstallerModule }
