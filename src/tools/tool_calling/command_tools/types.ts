export type CommandId = 'npm_test' | 'npm_typecheck' | 'npm_build' | 'git_status' | 'git_diff'

export interface CommandToolsOptions {
  workspaceRoot: string
  trustedPath?: string
  commandTimeoutMs?: number
}

export interface CommandResult {
  command_id: CommandId
  exit_code: number | null
  signal: NodeJS.Signals | null
  timed_out: boolean
  truncated: boolean
  stdout: string
  stderr: string
}

export interface CommandRuntime {
  executable: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
}

export interface ProcessSpec {
  executable: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes?: number
}

export interface ProcessResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  truncated: boolean
  stdout: string
  stderr: string
}
