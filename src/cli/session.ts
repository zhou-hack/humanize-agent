import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Agent, type AgentRunOptions, type AgentRunResult } from '../agent/index.js'
import type { LlmClient } from '../llm/types.js'
import { createMemoryTools, type MemoryService } from '../memory/index.js'
import { loadBuiltin, type LoadedBuiltin } from '../tools/index.js'
import {
  createWebSearchTools,
  createWorkspaceManager,
  ToolExecutor,
  ToolRegistry,
  type CommandApprovalHandler,
  type WorkspaceManager,
  type WorkspaceSnapshot
} from '../tools/tool_calling/index.js'

export type CliPermission = 'workspace' | 'approval'

export interface CliSnapshot {
  workspace: WorkspaceSnapshot
  permission: CliPermission
}

export interface CliSessionOptions {
  memory: MemoryService
  llm: LlmClient
  requestApproval: CommandApprovalHandler
  system?: string
  defaultDirectory?: string
  builtin?: LoadedBuiltin
  tavilyApiKey?: string
  onBuiltinWarning?: (message: string) => void
}

export function getDefaultWorkspaceDirectory(
  platform: NodeJS.Platform = process.platform,
  home = homedir()
): string {
  return platform === 'win32'
    ? join(home, 'Documents', 'humanize-agent-work')
    : join(home, 'humanize-agent-work')
}

export async function createCliSession(options: CliSessionOptions): Promise<CliSession> {
  const builtin = options.builtin ?? await loadBuiltin({ onWarning: options.onBuiltinWarning })
  try {
    const defaultDirectory = options.defaultDirectory ?? getDefaultWorkspaceDirectory()
    await mkdir(defaultDirectory, { recursive: true })
    const workspace = await createWorkspaceManager({ defaultDirectory })
    const agent = await buildAgent(workspace, 'workspace', options, builtin)
    return new CliSession(defaultDirectory, workspace, 'workspace', agent, options, builtin)
  } catch (error) {
    await builtin.close()
    throw error
  }
}

export class CliSession {
  private operationQueue: Promise<void> = Promise.resolve()
  private closePromise: Promise<void> | undefined
  private pendingPermissionNotice: string | undefined
  private closed = false

  constructor(
    private readonly defaultDirectory: string,
    private workspace: WorkspaceManager,
    private permission: CliPermission,
    private agent: Agent,
    private readonly options: CliSessionOptions,
    private readonly builtin: LoadedBuiltin
  ) {}

  snapshot(): CliSnapshot {
    return { workspace: this.workspace.getSnapshot(), permission: this.permission }
  }

  run(options: AgentRunOptions): Promise<AgentRunResult> {
    return this.serialize(() => {
      const notice = this.pendingPermissionNotice
      this.pendingPermissionNotice = undefined
      return this.agent.run(notice
        ? { ...options, text: `${notice}\n\n${options.text}` }
        : options
      )
    })
  }

  cd(directory: string): Promise<CliSnapshot> {
    return this.serialize(async () => {
      if (!directory.trim()) throw new Error('工作区路径不能为空')
      const target = resolve(this.workspace.getSnapshot().current_directory, directory)
      const candidate = await createWorkspaceManager({ defaultDirectory: this.defaultDirectory })
      await candidate.selectDirectory(target)
      const agent = await buildAgent(candidate, this.permission, this.options, this.builtin)
      this.workspace = candidate
      this.agent = agent
      return this.snapshot()
    })
  }

  setPermission(mode?: string): Promise<CliSnapshot> {
    return this.serialize(async () => {
      const next = mode ?? (this.permission === 'workspace' ? 'approval' : 'workspace')
      if (next !== 'workspace' && next !== 'approval') {
        throw new Error('仅支持 workspace、approval；open 暂未开放')
      }

      const previous = this.permission
      const candidate = await createWorkspaceManager({ defaultDirectory: this.defaultDirectory })
      await candidate.selectDirectory(this.workspace.getSnapshot().current_directory)
      const agent = await buildAgent(candidate, next, this.options, this.builtin)
      this.workspace = candidate
      this.permission = next
      this.agent = agent
      if (previous !== next) {
        this.pendingPermissionNotice = `CLI 运行状态通知：权限模式已从 ${previous} 切换为 ${next}，当前权限模式为 ${next}。`
      }
      return this.snapshot()
    })
  }

  close(): Promise<void> {
    this.closePromise ??= this.serialize(async () => {
      this.closed = true
      await this.builtin.close()
    })
    return this.closePromise
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(() => {
      if (this.closed) throw new Error('CLI 会话已关闭')
      return operation()
    })
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

async function buildAgent(
  workspace: WorkspaceManager,
  permission: CliPermission,
  options: CliSessionOptions,
  builtin: LoadedBuiltin
): Promise<Agent> {
  const builtinTools = permission === 'workspace'
    ? builtin.tools.filter((tool) => tool.effect === 'read')
    : builtin.tools
  const registry = new ToolRegistry([
    ...await workspace.createTools({
      mode: permission,
      requestApproval: options.requestApproval
    }),
    ...createMemoryTools({ store: options.memory.store, core: options.memory.core }),
    ...createWebSearchTools({ apiKey: options.tavilyApiKey ?? process.env.TAVILY_API_KEY }),
    ...builtinTools
  ])
  const currentDirectory = workspace.getSnapshot().current_directory
  const permissionContext = permission === 'workspace'
    ? '当前权限模式：workspace（默认）。run_command 仅允许当前工作区内的只读单命令白名单，禁止写入、shell 串接、变量代换、敏感文件和非白名单命令；也提供 list_directory（ls/dir）、get_workspace_directory（pwd）、read_file、edit_file、create_directory（mkdir）、move_path（move）、delete_path（delete）等专用工具，所有文件路径只能位于当前工作区内。'
    : '当前权限模式：approval。包含 workspace 的全部专用文件工具和只读命令能力；run_command 对只读单命令白名单直接放行，除当前工作区外也允许本机绝对路径的安全只读查看，敏感路径仍禁止；白名单外的 shell 命令必须经过用户审批后执行。'
  const workspaceContext = `当前运行状态（优先于历史消息中的旧目录和旧权限）：\n当前工作区（当前目录）的绝对路径：${currentDirectory}\n${permissionContext}\n用户消息中由 CLI 注入的「CLI 运行状态通知」仅用于内部状态同步，不是用户意图；回复必须表现得好像通知不存在，不要复述、确认、评论或回应通知本身，也不要主动提及当前权限、可用命令、此前被拒绝的命令或建议重新执行，只处理通知后的实际用户指令。若实际指令只是 hi、hello、你好等问候，只能自然回应问候，不得提及权限、工具、历史任务或操作建议。仅当用户明确询问运行状态或权限时，才可说明当前模式。\n文件工具的相对路径都基于该目录；读取当前目录使用 list_directory，path 可省略或传 .。`
  const system = [options.system, builtin.system, workspaceContext]
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n')
  return new Agent({
    memory: options.memory,
    llm: options.llm,
    registry,
    executor: new ToolExecutor(registry),
    system
  })
}
