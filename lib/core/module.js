class Module {
  static name = 'BaseModule'
  static phase = 'detect'
  static priority = 0
  static dependencies = []
  
  static capabilities = {
    search: false,
    serialize: false,
    updates: false
  }

  constructor(context, utilities) {
    this.context = context
    this.utils = utilities
  }

  async shouldRun() {
    return false
  }

  async run() {
    throw new Error(`${this.constructor.name}.run() not implemented`)
  }

  async cleanup() {}

  canSearch() {
    return this.constructor.capabilities?.search === true
  }

  async search(query) {
    throw new Error(`${this.constructor.name}.search() not implemented`)
  }

  canSerialize() {
    return this.constructor.capabilities?.serialize === true
  }

  matchesRecord(record) {
    return false
  }

  serialize(context) {
    return null
  }

  deserialize(record) {
    return null
  }

  canCheckUpdates() {
    return this.constructor.capabilities?.updates === true
  }

  async checkForUpdates(record) {
    return { hasUpdate: false, reason: 'Not implemented' }
  }

  log(message) {
    this.utils.log(message)
  }

  debug(message) {
    this.utils.debug(message)
  }

  warn(message) {
    this.utils.warn(message)
  }

  error(message) {
    this.utils.error(message)
  }
}

module.exports = { Module }
