const { Module } = require('../../core/module')
const { safeExecSync, processInstallSnippetReplacements, colors } = require('../../utils')

class ScriptInstallerModule extends Module {
  static name = 'ScriptInstaller'
  static phase = 'install'
  static priority = 100
  static dependencies = []

  async shouldRun() {
    const source = this.context.selectedSource
    return source && source.type === 'script'
  }

  async run() {
    const source = this.context.selectedSource
    
    this.log(`\n${colors.fg.green}${source.code}${colors.reset}\n`)
    
    const confirmed = await this.utils.confirm(
      'Run this install script?',
      'y'
    )
    
    if (!confirmed) {
      throw new Error('Script installation cancelled by user')
    }
    
    const processedCode = processInstallSnippetReplacements(source.code)
    
    this.debug('Running install script...')
    safeExecSync('sh', ['-c', processedCode], { stdio: 'inherit' })
    
    this.context.installResult = {
      method: 'script',
      destinations: [],
      binaries: []
    }
    
    this.log(`Successfully installed via script`)
  }
}

module.exports = { ScriptInstallerModule }
