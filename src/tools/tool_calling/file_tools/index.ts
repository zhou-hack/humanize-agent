import type { ToolDefinition } from '../types.js'
import { createEditFileTool } from './edit_file.js'
import { createListDirectoryTool } from './list_directory.js'
import { createReadFileTool } from './read_file.js'
import { createSearchTextTool } from './search_text.js'
import { createWorkspace } from './workspace.js'

export interface FileToolsOptions {
  workspaceRoot: string
}

export async function createFileTools(options: FileToolsOptions): Promise<ToolDefinition[]> {
  const workspace = await createWorkspace(options.workspaceRoot)
  return [
    createListDirectoryTool(workspace),
    createReadFileTool(workspace),
    createSearchTextTool(workspace),
    createEditFileTool(workspace)
  ]
}
