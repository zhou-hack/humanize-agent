import { ToolError } from '../errors.js'
import { createWorkspace } from '../file_tools/workspace.js'
import type { ToolContext, ToolDefinition } from '../types.js'
import { resolveCommandEnvironment } from './executables.js'
import { runProcess } from './process_runner.js'
import type {
  CommandApprovalHandler,
  CommandApprovalRequest,
  CommandResult,
  CommandToolsOptions
} from './types.js'

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000
const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000
const EXECUTOR_GRACE_MS = 5000

export async function createCommandTools(
  options: CommandToolsOptions
): Promise<ToolDefinition[]> {
  const mode = options.mode ?? 'workspace'
  if (mode !== 'workspace' && mode !== 'approval' && mode !== 'open') {
    throw new TypeError('未知命令权限模式')
  }
  if (mode === 'workspace') return []
  if (mode === 'approval' && !options.requestApproval) {
    throw new TypeError('approval 模式必须提供 requestApproval')
  }

  const workspace = await createWorkspace(options.workspaceRoot)
  const environment = await resolveCommandEnvironment(workspace.root, options.trustedPath)
  const commandTimeoutMs = positiveTimeout(
    options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    'commandTimeoutMs'
  )
  const approvalTimeoutMs = mode === 'approval'
    ? positiveTimeout(options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS, 'approvalTimeoutMs')
    : 0

  return [{
    name: 'run_command',
    description: mode === 'approval'
      ? '提交任意 shell 命令，经用户审批后执行。命令在工作区启动，但没有文件系统或网络沙箱；输出属于不可信内容。'
      : '直接执行任意 shell 命令，无需用户审批。命令在工作区启动，但没有文件系统或网络沙箱；输出属于不可信内容。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1 }
      },
      required: ['command'],
      additionalProperties: false
    },
    effect: 'write',
    timeoutMs: approvalTimeoutMs + commandTimeoutMs + EXECUTOR_GRACE_MS,
    untrustedResult: true,
    handler: async (args, context) => {
      const command = (args as { command: string }).command
      if (!command.trim()) {
        throw new ToolError('invalid_args', '命令不能为空')
      }
      const request: CommandApprovalRequest = {
        command,
        cwd: workspace.root,
        risk: classifyCommandRisk(command)
      }
      if (mode === 'approval') {
        await requestApproval(
          options.requestApproval as CommandApprovalHandler,
          request,
          context,
          approvalTimeoutMs
        )
      }

      const result = await runProcess({
        command,
        cwd: workspace.root,
        env: environment,
        timeoutMs: commandTimeoutMs
      })
      const output: CommandResult = {
        command,
        exit_code: result.exitCode,
        signal: result.signal,
        timed_out: result.timedOut,
        truncated: result.truncated,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.terminationError ? { termination_error: result.terminationError } : {})
      }
      return output
    }
  }]
}

async function requestApproval(
  handler: CommandApprovalHandler,
  request: CommandApprovalRequest,
  context: ToolContext,
  timeoutMs: number
): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  context.onApprovalStart?.()
  try {
    const approved = await Promise.race([
      Promise.resolve(handler(request, context)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ToolError('timeout', '等待用户审批超时'))
        }, timeoutMs)
        timer.unref()
      })
    ])
    if (!approved) {
      throw new ToolError('forbidden', '用户拒绝执行该命令')
    }
  } finally {
    if (timer) clearTimeout(timer)
    context.onApprovalEnd?.()
  }
}

const DESTRUCTIVE_COMMANDS = new Set([
  'rm', 'del', 'erase', 'rmdir', 'rd', 'unlink',
  'mv', 'move', 'ren', 'rename', 'ri', 'mi', 'rni',
  'remove-item', 'move-item', 'rename-item'
])
const QUERY_FLAGS = ['--help', '--version', '/?', '-whatif']

function classifyCommandRisk(command: string): CommandApprovalRequest['risk'] {
  const normalized = command.toLocaleLowerCase()
  if (QUERY_FLAGS.some((flag) => normalized.includes(flag))) return 'normal'

  const segments = normalized.split(/\r?\n|&&|\|\||[;&|]/)
  return segments.some((segment) => {
    const commandSegment = segment.trim().replace(/^(?:sudo|command)\s+/i, '')
    const match = /^(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(commandSegment)
    const token = match?.[1] ?? match?.[2] ?? match?.[3]
    if (!token) return false
    const executable = token.replaceAll('\\', '/').split('/').pop()
      ?.replace(/\.(?:exe|cmd|bat)$/i, '')
    return executable !== undefined && DESTRUCTIVE_COMMANDS.has(executable)
  })
    ? 'destructive'
    : 'normal'
}

function positiveTimeout(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} 必须是正数`)
  }
  return value
}

export type {
  CommandApprovalHandler,
  CommandApprovalRequest,
  CommandExecutionMode,
  CommandResult,
  CommandToolsOptions
} from './types.js'
