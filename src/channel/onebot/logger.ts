import type { AgentEvent } from '../../agent/index.js'
import type { OneBotConversationTarget } from './types.js'

const FILE_ACTIONS = new Map<string, 'read' | 'write'>([
  ['get_workspace_directory', 'read'],
  ['list_directory', 'read'],
  ['read_file', 'read'],
  ['search_text', 'read'],
  ['stat_path', 'read'],
  ['find_path', 'read'],
  ['edit_file', 'write'],
  ['create_directory', 'write'],
  ['move_path', 'write'],
  ['delete_path', 'write']
])

export class OneBotLogger {
  private readonly toolNames = new Map<string, string>()
  private thinkingScope: string | undefined

  constructor(
    private readonly write: (text: string) => void = (text) => {
      process.stdout.write(text)
    }
  ) {}

  receive(target: OneBotConversationTarget, text: string): void {
    this.writeLine(`[recvMessage] ${targetLabel(target)}: ${text}`)
  }

  send(target: OneBotConversationTarget, text: string): void {
    this.clearToolNames(target.scope)
    this.writeLine(`[sendMessage] ${targetLabel(target)}: ${text}`)
  }

  agentEvent(scope: string, event: AgentEvent): void {
    if (event.type === 'thinking_delta') {
      if (!event.text) return
      if (this.thinkingScope !== scope) {
        this.finishThinking()
        this.write('[think]: ')
        this.thinkingScope = scope
      }
      this.write(event.text)
      return
    }

    this.finishThinking()
    if (event.type === 'text_delta') return

    if (event.type === 'tool_call') {
      this.writeLine(`[tool] ${formatToolCall(event.call.name, event.call.arguments)}`)
      this.toolNames.set(toolKey(scope, event.call.id), event.call.name)
      const action = FILE_ACTIONS.get(event.call.name)
      if (action) {
        this.writeLine(`[files] ${action}: ${formatFileCall(event.call.name, event.call.arguments)}`)
      }
      return
    }

    const key = toolKey(scope, event.toolUseId)
    const name = this.toolNames.get(key)
    this.toolNames.delete(key)
    if (name !== 'web_search' || !event.result.ok) return
    for (const url of searchResultUrls(event.result.data)) {
      this.writeLine(`[tools] web_search: ${url}`)
    }
  }

  private writeLine(line: string): void {
    this.finishThinking()
    this.write(`${line}\n`)
  }

  private finishThinking(): void {
    if (this.thinkingScope === undefined) return
    this.thinkingScope = undefined
    this.write('\n')
  }

  private clearToolNames(scope: string): void {
    const prefix = `${scope}:`
    for (const key of this.toolNames.keys()) {
      if (key.startsWith(prefix)) this.toolNames.delete(key)
    }
  }
}

function targetLabel(target: OneBotConversationTarget): string {
  return target.kind === 'private'
    ? String(target.userId)
    : `group:${target.id} user:${target.userId}`
}

function toolKey(scope: string, toolUseId: string): string {
  return `${scope}:${toolUseId}`
}

function formatToolCall(name: string, args: unknown): string {
  if (!isRecord(args)) return name
  const keys = ['id', 'query', 'path', 'source', 'destination', 'url', 'command', 'title', 'limit', 'page', 'before', 'offset']
  const details = keys.flatMap((key) => {
    const value = args[key]
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return []
    const text = String(value).replace(/\s+/g, ' ').trim()
    return text ? [`${key}=${truncate(text, 120)}`] : []
  })
  return details.length > 0 ? `${name}: ${details.join(' ')}` : name
}

function formatFileCall(name: string, args: unknown): string {
  if (!isRecord(args)) return name
  const paths = ['path', 'source', 'destination']
    .flatMap((key) => typeof args[key] === 'string' ? [`${key}=${args[key]}`] : [])
  return paths.length > 0 ? `${name} ${paths.join(' ')}` : name
}

function truncate(text: string, maxChars: number): string {
  return Array.from(text).length <= maxChars
    ? text
    : `${Array.from(text).slice(0, maxChars).join('')}…`
}

function searchResultUrls(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data.results)) return []
  return data.results.flatMap((item) =>
    isRecord(item) && typeof item.url === 'string' ? [item.url] : []
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
