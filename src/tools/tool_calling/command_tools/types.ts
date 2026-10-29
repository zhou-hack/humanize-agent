import type { ToolContext } from '../types.js'
import type { CommandJudge, CommandReview } from './command_judge.js'

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
  /**
   * 白名单外命令的自动安全审核（open 模式忽略）。
   * workspace：不危险才执行，危险或审核失败即拒绝；approval：不危险直接执行，危险或审核失败转人工审批。
   */
  commandJudge?: CommandJudge
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
  review?: CommandReview
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
