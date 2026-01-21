const fs = require('fs')
const path = require('path')
const os = require('os')
const { Module } = require('../../core/module')
const { safeExecSync, checkPath } = require('../../utils')
const { extractArchive, isArchive } = require('../../extensions')
const { extractName } = require('../../config')

class ArchiveInstallerModule extends Module {
  static name = 'ArchiveInstaller'
  static phase = 'install'
  static priority = 75
  static dependencies = []

  async shouldRun() {
    const source = this.context.selectedSource
    if (!source || source.type === 'script') return false
    return isArchive(source.extension)
  }

  async run() {
    const source = this.context.selectedSource
    const archivePath = source.localPath || this.context.downloadPath
    const tmpdir = this.context.createTmpDir()
    const outputDir = path.join(tmpdir, 'extracted')
    
    fs.mkdirSync(outputDir, { recursive: true })
    
    this.debug(`Extracting ${source.name} to ${outputDir}`)
    extractArchive(archivePath, outputDir, source.extension)
    
    const contents = this._findInstallableContents(outputDir)
    this.debug(`Found ${contents.length} installable items: ${contents.join(', ')}`)
    
    const appFile = contents.find(f => f.endsWith('.app'))
    
    if (appFile) {
      const result = await this._installApp(appFile, outputDir, source.name)
      this.context.installResult = result
      return
    }
    
    const binaries = await this._findBinaries(outputDir)
    
    if (binaries.length === 0) {
      throw new Error('No binaries found in archive')
    }
    
    const result = await this._installBinaries(binaries, outputDir, source.name)
    this.context.installResult = result
  }

  _findInstallableContents(dir) {
    const results = []
    
    const walkDir = (currentDir, prefix = '') => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true })
        
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue
          
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
          
          if (entry.name.endsWith('.app')) {
            results.push(relativePath)
          } else if (entry.isDirectory()) {
            walkDir(path.join(currentDir, entry.name), relativePath)
          } else if (entry.isFile()) {
            results.push(relativePath)
          }
        }
      } catch {
      }
    }
    
    walkDir(dir)
    return results
  }

  async _findBinaries(dir) {
    const contents = this._findInstallableContents(dir)
    const binaries = []
    
    for (const file of contents) {
      const fullPath = path.join(dir, file)
      
      try {
        const stats = fs.statSync(fullPath)
        if (!stats.isFile()) continue
        if (stats.size === 0) continue
        
        const fileOutput = safeExecSync('file', [fullPath]).toString()
        
        if (fileOutput.includes('executable') || 
            fileOutput.includes('ELF') ||
            fileOutput.includes('Mach-O')) {
          binaries.push(file)
        }
      } catch {
      }
    }
    
    return binaries
  }

  async _installApp(appFile, outputDir, sourceName) {
    const srcPath = path.join(outputDir, appFile)
    const cleanName = extractName({ name: appFile }) || appFile.replace(/\.app$/i, '')
    const destPath = path.join('/Applications', `${cleanName}.app`)
    
    await checkPath(destPath, this.utils.yesFlag)
    
    fs.cpSync(srcPath, destPath, { recursive: true, preserveTimestamps: true })
    
    try {
      safeExecSync('codesign', ['--sign', '-', '--force', '--deep', destPath], { stdio: 'pipe' })
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
      method: 'archive_app',
      destinations: [destPath],
      binaries: [cleanName]
    }
  }

  async _installBinaries(binaries, outputDir, sourceName) {
    const binDir = path.join(os.homedir(), '.local', 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    
    const destinations = []
    const installedNames = []
    
    for (const binary of binaries) {
      const srcPath = path.join(outputDir, binary)
      const originalName = path.basename(binary)
      const cleanName = extractName({ name: originalName }) || originalName
      const destPath = path.join(binDir, cleanName)
      
      await checkPath(destPath, this.utils.yesFlag)
      
      fs.copyFileSync(srcPath, destPath)
      safeExecSync('chmod', ['+x', destPath])
      
      destinations.push(destPath)
      installedNames.push(cleanName)
      
      this.debug(`Installed ${cleanName} to ${destPath}`)
    }
    
    this.context.installedName = installedNames[0]
    
    this.log(`Installed: ${installedNames.join(', ')}`)
    
    return {
      method: 'binary',
      destinations,
      binaries: installedNames
    }
  }
}

module.exports = { ArchiveInstallerModule }
