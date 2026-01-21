const fs = require('fs')
const path = require('path')
const { Module } = require('../../core/module')
const { safeExecSync } = require('../../utils')
const { extractName } = require('../../config')

class DMGInstallerModule extends Module {
  static name = 'DMGInstaller'
  static phase = 'install'
  static priority = 90
  static dependencies = []

  async shouldRun() {
    const source = this.context.selectedSource
    if (!source || source.type === 'script') return false
    return source.extension === 'dmg'
  }

  async run() {
    const source = this.context.selectedSource
    const downloadPath = source.localPath || this.context.downloadPath
    const tmpdir = this.context.createTmpDir()
    const mountPoint = path.join(tmpdir, 'dmg-mount')
    
    fs.mkdirSync(mountPoint, { recursive: true })
    
    try {
      this._mount(downloadPath, mountPoint)
      const contents = this._getContents(mountPoint)
      
      this.debug(`Found ${contents.length} items in DMG: ${contents.join(', ')}`)
      
      const appFile = contents.find(f => f.endsWith('.app'))
      const pkgFile = contents.find(f => f.endsWith('.pkg'))
      
      if (appFile) {
        const result = await this._installApp(appFile, mountPoint, source.name)
        this.context.installResult = result
      } else if (pkgFile) {
        const result = this._installPkg(pkgFile, mountPoint)
        this.context.installResult = result
      } else {
        throw new Error('No .app or .pkg found in DMG')
      }
    } finally {
      this._eject(mountPoint)
    }
  }

  _mount(dmgPath, mountPoint) {
    if (fs.existsSync(mountPoint)) {
      fs.rmSync(mountPoint, { recursive: true, force: true })
    }
    fs.mkdirSync(mountPoint, { recursive: true })
    
    safeExecSync('hdiutil', ['attach', dmgPath, '-nobrowse', '-mountpoint', mountPoint])
    this.debug(`Mounted DMG at ${mountPoint}`)
  }

  _eject(mountPoint) {
    try {
      safeExecSync('hdiutil', ['eject', mountPoint])
      this.debug(`Ejected DMG from ${mountPoint}`)
    } catch (e) {
      try {
        safeExecSync('hdiutil', ['eject', mountPoint, '-force'])
      } catch {
        this.warn(`Failed to eject DMG: ${e.message}`)
      }
    }
  }

  _getContents(mountPoint) {
    return fs.readdirSync(mountPoint).filter(f => {
      const lower = f.toLowerCase()
      return !lower.startsWith('.') && 
             !lower.includes('__macosx') &&
             f !== 'Applications'
    })
  }

  async _installApp(appFile, mountPoint, sourceName) {
    const srcPath = path.join(mountPoint, appFile)
    const cleanName = extractName({ name: appFile }) || appFile.replace(/\.app$/i, '')
    const destPath = path.join('/Applications', `${cleanName}.app`)
    
    const { checkPath } = require('../../utils')
    await checkPath(destPath, this.utils.yesFlag)
    
    try {
      safeExecSync('rsync', ['-a', '--copy-links', '--protect-args', `${srcPath}/`, destPath])
    } catch {
      fs.cpSync(srcPath, destPath, { recursive: true, preserveTimestamps: true })
    }
    
    try {
      safeExecSync('codesign', ['--sign', '-', '--force', '--deep', destPath], { stdio: 'pipe' })
    } catch {
      this.warn('Codesigning failed - app may show security warnings')
    }
    
    try {
      safeExecSync('xattr', ['-rd', 'com.apple.quarantine', destPath], { stdio: 'pipe' })
    } catch {
    }
    
    this.log(`Installed ${cleanName}.app to /Applications`)
    
    const openApp = await this.utils.confirm(`Open ${cleanName}?`, 'y')
    if (openApp) {
      safeExecSync('open', ['-n', destPath])
    }
    
    this.context.installedName = cleanName
    
    return {
      method: 'dmg_app',
      destinations: [destPath],
      binaries: [cleanName]
    }
  }

  _installPkg(pkgFile, mountPoint) {
    const pkgPath = path.join(mountPoint, pkgFile)
    safeExecSync('sudo', ['installer', '-pkg', pkgPath, '-target', '/'])
    
    this.log(`Installed ${pkgFile} system-wide`)
    
    return {
      method: 'dmg_pkg',
      destinations: ['System-wide package installation'],
      binaries: [pkgFile]
    }
  }
}

module.exports = { DMGInstallerModule }
