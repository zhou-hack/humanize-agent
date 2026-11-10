import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Agent, TOOL_ROUND_SOFT_LIMIT, type AgentRunOptions, type AgentRunResult } from '../agent/index.js'
import { parseBridgeRole } from '../bridge/roles.js'
import type { KnowledgeAudience } from '../knowledge/index.js'
import type { LlmClient } from '../llm/types.js'
import { renderPrompt } from '../prompt/loader.js'
import type { KnowledgeService } from '../knowledge/index.js'
import { createKnowledgeTools } from '../knowledge/tools.js'
import { createMemoryTools, type MemoryService } from '../memory/index.js'
import { loadBuiltin, type LoadedBuiltin } from '../tools/index.js'
import {
  createWebFetchTools,
  createWebSearchTools,
  createWorkspaceManager,
  ToolExecutor,
  ToolRegistry,
  type CommandApprovalHandler,
  type CommandJudge,
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
  knowledge: KnowledgeService
  llm: LlmClient
  requestApproval: CommandApprovalHandler
  system?: string
  defaultDirectory?: string
  builtin?: LoadedBuiltin
  tavilyApiKey?: string
  /** workspace 模式下白名单外命令的自动安全审核器。 */
  commandJudge?: CommandJudge
  onBuiltinWarning?: (message: string) => void
  memoryScope?: string
  allowCoreWrite?: boolean
  knowledgeAudience?: KnowledgeAudience
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

  startNewConversation(): Promise<void> {
    return this.serialize(async () => {
      await this.options.memory.startNewConversation(this.options.memoryScope)
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
        this.pendingPermissionNotice = renderPrompt('session/permission-notice', { previous, next })
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
  const knowledgeAudience = options.knowledgeAudience ?? parseBridgeRole(process.env.BRIDGE_ROLE)
  const registry = new ToolRegistry([
    ...await workspace.createTools({
      mode: permission,
      requestApproval: options.requestApproval,
      commandJudge: options.commandJudge
    }),
    ...createMemoryTools({
      store: options.memory.store,
      core: options.memory.core,
      scope: options.memoryScope,
      allowCoreWrite: options.allowCoreWrite
    }),
    ...createKnowledgeTools(options.knowledge, { audience: knowledgeAudience }),
    ...createWebSearchTools({
      apiKey: options.tavilyApiKey ?? process.env.TAVILY_API_KEY,
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
      mode: process.env.WEB_SEARCH_MODE,
      proxyUrl: process.env.WEB_SEARCH_PROXY_URL
    }),
    ...createWebFetchTools({
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
      mode: process.env.WEB_SEARCH_MODE,
      proxyUrl: process.env.WEB_SEARCH_PROXY_URL
    }),
    ...builtinTools
  ])
  const currentDirectory = workspace.getSnapshot().current_directory
  const permissionContext = permission === 'workspace'
    ? options.commandJudge
      ? renderPrompt('init/permission-workspace-judge')
      : renderPrompt('init/permission-workspace')
    : options.commandJudge
      ? renderPrompt('init/permission-approval-judge')
      : renderPrompt('init/permission-approval')
  const workspaceContext = renderPrompt('init/workspace', { currentDirectory, permissionContext })
  const toolUseGuide = renderPrompt('init/tool-guide', { maxToolRounds: TOOL_ROUND_SOFT_LIMIT })
  const knowledgeGuide = renderPrompt('init/knowledge', { audience: knowledgeAudience })
  const system = [options.system, builtin.system, toolUseGuide, knowledgeGuide, workspaceContext]
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n')
  return new Agent({
    memory: options.memory,
    llm: options.llm,
    registry,
    executor: new ToolExecutor(registry),
    system,
    memoryScope: options.memoryScope
  })
}
