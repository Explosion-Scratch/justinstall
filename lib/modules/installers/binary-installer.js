const fs = require('fs')
const path = require('path')
const os = require('os')
const { Module } = require('../../core/module')
const { safeExecSync, checkPath } = require('../../utils')
const { extractName } = require('../../config')

class BinaryInstallerModule extends Module {
  static name = 'BinaryInstaller'
  static phase = 'install'
  static priority = 70
  static dependencies = []

  async shouldRun() {
    const source = this.context.selectedSource
    if (!source || source.type === 'script') return false
    
    if (!source.extension || source.extension === '') {
      return true
    }
    
    return false
  }

  async run() {
    const source = this.context.selectedSource
    const srcPath = source.localPath || this.context.downloadPath
    
    const binDir = path.join(os.homedir(), '.local', 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    
    const originalName = source.name
    const cleanName = extractName({ name: originalName }) || originalName
    const destPath = path.join(binDir, cleanName)
    
    await checkPath(destPath, this.utils.yesFlag)
    
    fs.copyFileSync(srcPath, destPath)
    safeExecSync('chmod', ['+x', destPath])
    
    this.context.installedName = cleanName
    
    this.log(`Installed ${cleanName} to ${destPath}`)
    
    this.context.installResult = {
      method: 'binary',
      destinations: [destPath],
      binaries: [cleanName]
    }
  }
}

module.exports = { BinaryInstallerModule }
