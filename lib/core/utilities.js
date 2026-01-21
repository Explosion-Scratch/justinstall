const { createLogger, confirm, promptChoice, fileSize } = require('../utils')

class ModuleUtilities {
  constructor(logger = null, yesFlag = false) {
    this.logger = logger || createLogger()
    this.yesFlag = yesFlag
  }

  log(message) {
    this.logger.log(message)
  }

  debug(message) {
    this.logger.debug(message)
  }

  warn(message) {
    this.logger.warn(message)
  }

  error(message) {
    this.logger.error(message)
  }

  async confirm(question, defaultAnswer = 'y') {
    return confirm(question, defaultAnswer, this.yesFlag)
  }

  async promptChoice(question, maxChoice) {
    return promptChoice(question, maxChoice, this.yesFlag)
  }

  formatSize(bytes) {
    return fileSize(bytes)
  }

  createProgressBar(options = {}) {
    try {
      const cliProgress = require('cli-progress')
      return new cliProgress.SingleBar({
        format: options.format || '{bar} {percentage}% | {value}/{total} | {eta}s remaining',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        ...options
      })
    } catch {
      return {
        start: () => {},
        update: () => {},
        stop: () => {}
      }
    }
  }
}

module.exports = { ModuleUtilities }
