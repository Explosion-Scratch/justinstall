const { PHASES } = require('./types')

class ModuleRegistry {
  constructor() {
    this.modules = new Map()
  }

  register(ModuleClass) {
    if (!ModuleClass.name) {
      throw new Error('Module must have a static name property')
    }
    this.modules.set(ModuleClass.name, ModuleClass)
    return this
  }

  registerAll(moduleClasses) {
    for (const ModuleClass of moduleClasses) {
      this.register(ModuleClass)
    }
    return this
  }

  get(name) {
    return this.modules.get(name)
  }

  has(name) {
    return this.modules.has(name)
  }

  getByPhase(phase) {
    return [...this.modules.values()]
      .filter(m => m.phase === phase)
      .sort((a, b) => b.priority - a.priority)
  }

  getAllByPhase() {
    const result = {}
    for (const phase of PHASES) {
      result[phase] = this.getByPhase(phase)
    }
    return result
  }

  instantiate(ModuleClass, context, utilities) {
    return new ModuleClass(context, utilities)
  }

  checkDependencies(ModuleClass) {
    const missing = []
    for (const dep of ModuleClass.dependencies || []) {
      if (!this.has(dep)) {
        missing.push(dep)
      }
    }
    return missing
  }

  validateAll() {
    const errors = []
    for (const [name, ModuleClass] of this.modules) {
      const missing = this.checkDependencies(ModuleClass)
      if (missing.length > 0) {
        errors.push(`${name} missing dependencies: ${missing.join(', ')}`)
      }
    }
    return errors
  }

  list() {
    return [...this.modules.keys()]
  }

  size() {
    return this.modules.size
  }
}

module.exports = { ModuleRegistry }
