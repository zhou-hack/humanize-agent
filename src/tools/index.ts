import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadBuiltinMcp, type McpTransportFactory } from './mcp/loader.js'
import { loadBuiltinSkills } from './skill/loader.js'
import type { BuiltinWarningHandler, LoadedBuiltin } from './types.js'
import { renderPrompt } from '../prompt/loader.js'

export interface LoadBuiltinOptions {
  root?: string
  onWarning?: BuiltinWarningHandler
  transportFactory?: McpTransportFactory
}

export async function loadBuiltin(options: LoadBuiltinOptions = {}): Promise<LoadedBuiltin> {
  const root = options.root ?? fileURLToPath(new URL('../data/tools/', import.meta.url))
  const skills = await loadBuiltinSkills(path.join(root, 'skill', 'builtin'))
  const mcp = await loadBuiltinMcp(path.join(root, 'mcp', 'builtin'), {
    onWarning: options.onWarning,
    transportFactory: options.transportFactory
  })

  let closePromise: Promise<void> | undefined
  return {
    tools: [...skills.tools, ...mcp.tools],
    ...(skills.system
      ? { system: renderPrompt('init/skills', { entries: skills.system }) }
      : {}),
    close: () => {
      closePromise ??= mcp.close()
      return closePromise
    }
  }
}

export type { BuiltinWarningHandler, LoadedBuiltin } from './types.js'
