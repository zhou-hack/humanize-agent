import { createCommandTools, type CommandToolsOptions } from './command_tools/index.js'
import { createFileTools } from './file_tools/index.js'
import { createWorkspace, type Workspace } from './file_tools/workspace.js'
import type { ToolDefinition } from './types.js'

export interface WorkspaceManagerOptions {
  defaultDirectory: string
}

export type WorkspaceToolOptions = Omit<CommandToolsOptions, 'workspaceRoot'>

export interface WorkspaceSnapshot {
  default_directory: string
  current_directory: string
  is_default: boolean
}

export class WorkspaceManager {
  private current: Workspace

  private constructor(private readonly defaultWorkspace: Workspace) {
    this.current = defaultWorkspace
  }

  static async create(options: WorkspaceManagerOptions): Promise<WorkspaceManager> {
    return new WorkspaceManager(await createWorkspace(options.defaultDirectory))
  }

  getSnapshot(): WorkspaceSnapshot {
    return {
      default_directory: this.defaultWorkspace.root,
      current_directory: this.current.root,
      is_default: this.current.root === this.defaultWorkspace.root
    }
  }

  async selectDirectory(directory: string): Promise<WorkspaceSnapshot> {
    this.current = await createWorkspace(directory)
    return this.getSnapshot()
  }

  useDefaultDirectory(): WorkspaceSnapshot {
    this.current = this.defaultWorkspace
    return this.getSnapshot()
  }

  async createTools(options: WorkspaceToolOptions = {}): Promise<ToolDefinition[]> {
    const workspaceRoot = this.current.root
    const [files, commands] = await Promise.all([
      createFileTools({ workspaceRoot }),
      createCommandTools({ workspaceRoot, ...options })
    ])
    return [...files, ...commands]
  }
}

export async function createWorkspaceManager(
  options: WorkspaceManagerOptions
): Promise<WorkspaceManager> {
  return WorkspaceManager.create(options)
}
