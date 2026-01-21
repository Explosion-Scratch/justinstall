const { PHASES } = require('./types')

class ModuleRunner {
  constructor(registry, utilities) {
    this.registry = registry
    this.utilities = utilities
    this.executedModules = new Set()
  }

  async run(context) {
    try {
      for (const phase of PHASES) {
        await this._runPhase(phase, context)
      }
      return context.installResult
    } finally {
      await this._cleanup(context)
    }
  }

  async _runPhase(phase, context) {
    const modules = this.registry.getByPhase(phase)
    this.utilities.debug(`Running phase: ${phase} (${modules.length} modules)`)

    for (const ModuleClass of modules) {
      await this._runModule(ModuleClass, context)
    }
  }

  async _runModule(ModuleClass, context) {
    const instance = this.registry.instantiate(ModuleClass, context, this.utilities)
    
    try {
      const shouldRun = await instance.shouldRun()
      
      if (shouldRun) {
        this.utilities.debug(`Running module: ${ModuleClass.name}`)
        await instance.run()
        this.executedModules.add(ModuleClass.name)
      }
    } catch (error) {
      this.utilities.error(`Module ${ModuleClass.name} failed: ${error.message}`)
      throw error
    }
  }

  async _cleanup(context) {
    const allModules = [...this.registry.modules.values()]
    
    for (const ModuleClass of allModules) {
      if (this.executedModules.has(ModuleClass.name)) {
        try {
          const instance = this.registry.instantiate(ModuleClass, context, this.utilities)
          await instance.cleanup()
        } catch {
        }
      }
    }
    
    context.cleanup()
  }

  async runSinglePhase(phase, context) {
    await this._runPhase(phase, context)
  }

  getExecutedModules() {
    return [...this.executedModules]
  }
}

module.exports = { ModuleRunner }
