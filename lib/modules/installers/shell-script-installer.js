const fs = require('fs')
const path = require('path')
const { Module } = require('../../core/module')
const { safeExecSync, colors } = require('../../utils')
const {
  isInstallerScript,
  isInstallerScriptCompatible,
  getInstallerScriptConfig,
  executeInstallerScript,
  previewInstallerScript
} = require('../../installer-scripts')

class ShellScriptInstallerModule extends Module {
  static name = 'ShellScriptInstaller'
  static phase = 'install'
  static priority = 95
  static dependencies = []

  async shouldRun() {
    const source = this.context.selectedSource
    if (!source) return false
    
    const ext = source.extension?.toLowerCase()
    return isInstallerScript(ext) && isInstallerScriptCompatible(ext)
  }

  async run() {
    const source = this.context.selectedSource
    const scriptPath = source.localPath || this.context.downloadPath
    const ext = source.extension?.toLowerCase()
    const config = getInstallerScriptConfig(ext)

    this.log(`Found ${config.description}: ${source.name}`)

    const preview = previewInstallerScript(scriptPath, 15)
    this.log(`\n${colors.fg.cyan}Script preview:${colors.reset}`)
    this.log(`${colors.fg.green}${preview}${colors.reset}\n`)

    const confirmed = await this.utils.confirm(
      `Run this installer script?`,
      'y'
    )

    if (!confirmed) {
      throw new Error('Installer script execution cancelled by user')
    }

    const result = executeInstallerScript(scriptPath, ext, {}, this)

    this.context.installResult = {
      method: result.method,
      destinations: [scriptPath],
      binaries: [path.basename(scriptPath)]
    }

    this.log(`Successfully ran installer script: ${source.name}`)
  }
}

module.exports = { ShellScriptInstallerModule }
