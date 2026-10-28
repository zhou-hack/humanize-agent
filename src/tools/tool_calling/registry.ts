import { Ajv, type ValidateFunction } from 'ajv'
import type { ToolDefinition } from './types.js'

export interface RegisteredTool {
  definition: ToolDefinition
  validate: ValidateFunction
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>()
  private readonly ajv = new Ajv({
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    strict: true
  })

  constructor(definitions: Iterable<ToolDefinition> = []) {
    for (const definition of definitions) {
      this.register(definition)
    }
  }

  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`工具已注册: ${definition.name}`)
    }

    const validate = this.ajv.compile(definition.parameters)
    this.tools.set(definition.name, { definition, validate })
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition)
  }
}
