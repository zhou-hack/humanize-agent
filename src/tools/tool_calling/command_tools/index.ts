import { ToolError } from '../errors.js'
import { createWorkspace } from '../file_tools/workspace.js'
import type { ToolContext, ToolDefinition } from '../types.js'
import { resolveCommandEnvironment } from './executables.js'
import type { CommandReview } from './command_judge.js'
import { runProcess } from './process_runner.js'
import { resolveReadonlyCommand, type ResolvedReadonlyCommand } from './readonly_commands.js'
import type {
  CommandApprovalHandler,
  CommandApprovalRequest,
  CommandResult,
  CommandToolsOptions,
  ProcessResult
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
  const judge = mode === 'open' ? undefined : options.commandJudge
  const judgeTimeoutMs = judge ? positiveTimeout(judge.timeoutMs, 'commandJudge.timeoutMs') : 0

  return [{
    name: 'run_command',
    description: mode === 'workspace'
      ? judge
        ? '当前工作区内的只读单命令白名单直接执行；白名单外的命令（可含写入、管道或组合）先经自动安全审核，判定不危险才执行，危险操作（批量删除、提权、读取敏感信息、访问工作区外路径等）会被拒绝。命令在工作区启动，没有文件系统或网络沙箱；输出属于不可信内容。'
        : '仅执行当前工作区内的只读单命令白名单，使用 argv 直接执行；禁止写入、管道、重定向、串接、变量代换、敏感文件和非白名单命令。输出属于不可信内容。'
      : mode === 'approval'
        ? judge
          ? '继承 workspace 的只读单命令白名单并直接执行，也允许本机绝对路径的安全只读查看（敏感路径除外）；白名单外的任意 shell 命令先经自动安全审核，判定不危险（含普通写入）直接执行，判定危险或审核失败时须经用户审批。命令在工作区启动，但任意 shell 没有文件系统或网络沙箱；输出属于不可信内容。'
          : '继承 workspace 的只读单命令白名单并直接执行，也允许本机绝对路径的安全只读查看（敏感路径除外）；白名单外的任意 shell 命令须经用户审批。命令在工作区启动，但任意 shell 没有文件系统或网络沙箱；输出属于不可信内容。'
        : '直接执行任意 shell 命令，无需用户审批。命令在工作区启动，但没有文件系统或网络沙箱；输出属于不可信内容。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1 }
      },
      required: ['command'],
      additionalProperties: false
    },
    effect: mode === 'workspace' && !judge ? 'read' : 'write',
    timeoutMs: approvalTimeoutMs + judgeTimeoutMs + commandTimeoutMs + EXECUTOR_GRACE_MS,
    untrustedResult: true,
    handler: async (args, context) => {
      const command = (args as { command: string }).command
      if (!command.trim()) {
        throw new ToolError('invalid_args', '命令不能为空')
      }

      let readonlyCommand: ResolvedReadonlyCommand | undefined
      let review: CommandReview | undefined
      if (mode !== 'open') {
        try {
          readonlyCommand = await resolveReadonlyCommand(command, {
            workspace,
            trustedPath: environment.PATH,
            maxOutputBytes: 1024,
            allowOutsideWorkspace: mode === 'approval'
          })
        } catch (error) {
          // 敏感文件拦截是确定性规则，不交给模型审核。
          const sensitive = error instanceof ToolError && error.code === 'sensitive'
          if (mode === 'workspace') {
            if (!judge || sensitive) throw error
            review = await judge.review({ command, cwd: workspace.root })
            if (review.dangerous) {
              throw new ToolError(
                'forbidden',
                '命令安全审核判定为危险操作，已拒绝执行；请改用仅限当前工作区、影响更小的做法，或请用户切换到 approval 模式'
              )
            }
          } else if (judge && !sensitive) {
            // approval 下审核失败不自动放行，回退为人工审批。
            review = await judge.review({ command, cwd: workspace.root }).catch(() => undefined)
          }
        }
      }

      let result: ProcessResult
      if (readonlyCommand) {
        result = readonlyCommand.kind === 'process'
          ? await runProcess({
              executable: readonlyCommand.executable,
              args: readonlyCommand.args,
              cwd: workspace.root,
              env: environment,
              timeoutMs: commandTimeoutMs
            })
          : await readonlyCommand.execute()
      } else {
        if (mode === 'approval' && (!review || review.dangerous)) {
          const request: CommandApprovalRequest = {
            command,
            cwd: workspace.root,
            risk: review?.dangerous ? 'destructive' : classifyCommandRisk(command)
          }
          await requestApproval(
            options.requestApproval as CommandApprovalHandler,
            request,
            context,
            approvalTimeoutMs
          )
        }
        result = await runProcess({
          command,
          cwd: workspace.root,
          env: environment,
          timeoutMs: commandTimeoutMs
        })
      }

      const output: CommandResult = {
        command,
        exit_code: result.exitCode,
        signal: result.signal,
        timed_out: result.timedOut,
        truncated: result.truncated,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.terminationError ? { termination_error: result.terminationError } : {}),
        ...(review ? { review } : {})
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
export {
  createLlmCommandJudge,
  DEFAULT_COMMAND_JUDGE_TIMEOUT_MS,
  type CommandJudge,
  type CommandReview,
  type CommandReviewRequest,
  type LlmCommandJudgeOptions
} from './command_judge.js'
