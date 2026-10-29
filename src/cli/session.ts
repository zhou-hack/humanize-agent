import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Agent, type AgentRunOptions, type AgentRunResult } from '../agent/index.js'
import type { LlmClient } from '../llm/types.js'
import { createMemoryTools, type MemoryService } from '../memory/index.js'
import {
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
  const defaultDirectory = options.defaultDirectory ?? getDefaultWorkspaceDirectory()
  await mkdir(defaultDirectory, { recursive: true })
  const workspace = await createWorkspaceManager({ defaultDirectory })
  const agent = await buildAgent(workspace, 'workspace', options)
  return new CliSession(defaultDirectory, workspace, 'workspace', agent, options)
}

export class CliSession {
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly defaultDirectory: string,
    private workspace: WorkspaceManager,
    private permission: CliPermission,
    private agent: Agent,
    private readonly options: CliSessionOptions
  ) {}

  snapshot(): CliSnapshot {
    return { workspace: this.workspace.getSnapshot(), permission: this.permission }
  }

  run(options: AgentRunOptions): Promise<AgentRunResult> {
    return this.serialize(() => this.agent.run(options))
  }

  cd(directory: string): Promise<CliSnapshot> {
    return this.serialize(async () => {
      if (!directory.trim()) throw new Error('工作区路径不能为空')
      const target = resolve(this.workspace.getSnapshot().current_directory, directory)
      const candidate = await createWorkspaceManager({ defaultDirectory: this.defaultDirectory })
      await candidate.selectDirectory(target)
      const agent = await buildAgent(candidate, this.permission, this.options)
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

      const candidate = await createWorkspaceManager({ defaultDirectory: this.defaultDirectory })
      await candidate.selectDirectory(this.workspace.getSnapshot().current_directory)
      const agent = await buildAgent(candidate, next, this.options)
      this.workspace = candidate
      this.permission = next
      this.agent = agent
      return this.snapshot()
    })
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

async function buildAgent(
  workspace: WorkspaceManager,
  permission: CliPermission,
  options: CliSessionOptions
): Promise<Agent> {
  const registry = new ToolRegistry([
    ...await workspace.createTools({
      mode: permission,
      requestApproval: options.requestApproval
    }),
    ...createMemoryTools({ store: options.memory.store, core: options.memory.core })
  ])
  return new Agent({
    memory: options.memory,
    llm: options.llm,
    registry,
    executor: new ToolExecutor(registry),
    system: options.system
  })
}
