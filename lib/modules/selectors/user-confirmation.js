const { Module } = require('../../core/module')

class UserConfirmationModule extends Module {
  static name = 'UserConfirmation'
  static phase = 'select'
  static priority = 90
  static dependencies = ['AssetSelector']

  async shouldRun() {
    return this.context.selectedSource !== null
  }

  async run() {
    const source = this.context.selectedSource
    const isUpdate = this.context.options.isUpdate || false
    const action = isUpdate ? 'update' : 'install'
    
    let description
    if (source.type === 'script') {
      description = source.name
    } else {
      const sizeStr = source.size ? ` (${this.utils.formatSize(source.size)})` : ''
      description = `${source.name}${sizeStr}`
    }
    
    const confirmed = await this.utils.confirm(
      `Ok to ${action} ${description}?`,
      'y'
    )
    
    if (!confirmed) {
      throw new Error(`${action} aborted by user`)
    }
    
    this.log(`Installing: ${source.name}`)
  }
}

module.exports = { UserConfirmationModule }
