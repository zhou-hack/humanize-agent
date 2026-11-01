import { readFileSync } from 'node:fs'

const PROMPT_FILES = {
  'init/default-system': 'init.md#default-system',
  'init/skills': 'init.md#skills',
  'init/tool-guide': 'init.md#tool-guide',
  'init/workspace': 'init.md#workspace',
  'init/permission-workspace': 'init.md#permission-workspace',
  'init/permission-workspace-judge': 'init.md#permission-workspace-judge',
  'init/permission-approval': 'init.md#permission-approval',
  'init/permission-approval-judge': 'init.md#permission-approval-judge',
  'init/memory-core': 'init.md#memory-core',
  'init/memory-recent': 'init.md#memory-recent',
  'session/current-time': 'session.md#current-time',
  'session/permission-notice': 'session.md#permission-notice',
  'session/tool-round-limit': 'session.md#tool-round-limit',
  'task/summarize': 'task/summarize.md',
  'task/command-judge': 'task/command-judge.md'
} as const

export type PromptName = keyof typeof PROMPT_FILES
export type PromptVariables = Record<string, string | number>

const templateCache = new Map<PromptName, string>()
const sourceCache = new Map<string, string>()

export function renderPrompt(name: PromptName, variables: PromptVariables = {}): string {
  let template = templateCache.get(name)
  if (template === undefined) {
    const location = PROMPT_FILES[name]
    if (!location) throw new Error(`未知提示模板：${name}`)
    const separator = location.indexOf('#')
    const file = separator < 0 ? location : location.slice(0, separator)
    const section = separator < 0 ? '' : location.slice(separator + 1)

    let source = sourceCache.get(file)
    if (source === undefined) {
      source = readFileSync(new URL(file, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
      sourceCache.set(file, source)
    }
    template = (section ? readSection(source, file, section) : source).trim()
    if (!template) throw new Error(`提示模板不能为空：${name}`)
    templateCache.set(name, template)
  }

  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (placeholder, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) {
      throw new Error(`提示模板 ${name} 缺少变量 ${key}（${placeholder}）`)
    }
    return String(variables[key])
  })
}

function readSection(source: string, file: string, section: string): string {
  const heading = new RegExp(`^## ${section}[\\t ]*$`, 'm').exec(source)
  if (!heading) throw new Error(`提示文件 ${file} 缺少模板区块：${section}`)
  const content = source.slice(heading.index + heading[0].length)
  const nextHeading = /^## [a-z0-9-]+[\t ]*$/m.exec(content)
  return nextHeading ? content.slice(0, nextHeading.index) : content
}
