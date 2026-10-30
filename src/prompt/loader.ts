import { readFileSync } from 'node:fs'

const PROMPT_FILES = {
  'init/default-system': 'init/default-system.md',
  'init/skills': 'init/skills.md',
  'init/tool-guide': 'init/tool-guide.md',
  'init/workspace': 'init/workspace.md',
  'init/permission-workspace': 'init/permission-workspace.md',
  'init/permission-workspace-judge': 'init/permission-workspace-judge.md',
  'init/permission-approval': 'init/permission-approval.md',
  'init/permission-approval-judge': 'init/permission-approval-judge.md',
  'init/memory-core': 'init/memory-core.md',
  'init/memory-recent': 'init/memory-recent.md',
  'session/current-time': 'session/current-time.md',
  'session/permission-notice': 'session/permission-notice.md',
  'session/tool-round-limit': 'session/tool-round-limit.md',
  'task/summarize': 'task/summarize.md',
  'task/command-judge': 'task/command-judge.md'
} as const

export type PromptName = keyof typeof PROMPT_FILES
export type PromptVariables = Record<string, string | number>

const cache = new Map<PromptName, string>()

export function renderPrompt(name: PromptName, variables: PromptVariables = {}): string {
  let template = cache.get(name)
  if (template === undefined) {
    const file = PROMPT_FILES[name]
    if (!file) throw new Error(`未知提示模板：${name}`)
    template = readFileSync(new URL(file, import.meta.url), 'utf8').replaceAll('\r\n', '\n').trim()
    if (!template) throw new Error(`提示模板不能为空：${name}`)
    cache.set(name, template)
  }

  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (placeholder, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) {
      throw new Error(`提示模板 ${name} 缺少变量 ${key}（${placeholder}）`)
    }
    return String(variables[key])
  })
}
