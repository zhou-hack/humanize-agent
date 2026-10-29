import type { ToolContext } from '../types.js'

export type CommandExecutionMode = 'workspace' | 'approval' | 'open'

export interface CommandApprovalRequest {
  command: string
  cwd: string
  risk: 'normal' | 'destructive'
}

export type CommandApprovalHandler = (
  request: CommandApprovalRequest,
  context: ToolContext
) => boolean | Promise<boolean>

export interface CommandToolsOptions {
  workspaceRoot: string
  mode?: CommandExecutionMode
  trustedPath?: string
  commandTimeoutMs?: number
  approvalTimeoutMs?: number
  requestApproval?: CommandApprovalHandler
}

export interface CommandResult {
  command: string
  exit_code: number | null
  signal: NodeJS.Signals | null
  timed_out: boolean
  truncated: boolean
  stdout: string
  stderr: string
  termination_error?: string
}

interface ProcessSpecBase {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes?: number
}

export type ProcessSpec = ProcessSpecBase & (
  | { executable: string; args: readonly string[] }
  | { command: string }
)

export interface ProcessResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  truncated: boolean
  stdout: string
  stderr: string
  terminationError?: string
}
