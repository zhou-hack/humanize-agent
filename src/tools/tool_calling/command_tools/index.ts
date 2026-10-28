import { ToolError } from '../errors.js'
import { createWorkspace } from '../file_tools/workspace.js'
import type { ToolDefinition } from '../types.js'
import { COMMAND_DEFINITIONS, COMMAND_IDS } from './commands.js'
import { resolveCommandRuntimes } from './executables.js'
import { runProcess } from './process_runner.js'
import type { CommandId, CommandResult, CommandToolsOptions } from './types.js'

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000
const EXECUTOR_GRACE_MS = 5000

export async function createCommandTools(
  options: CommandToolsOptions
): Promise<ToolDefinition[]> {
  const workspace = await createWorkspace(options.workspaceRoot)
  const runtimes = await resolveCommandRuntimes(workspace.root, options.trustedPath)
  const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS

  if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
    throw new TypeError('commandTimeoutMs 必须是正数')
  }

  return [{
    name: 'run_command',
    description:
      '执行固定白名单命令：npm_test、npm_typecheck、npm_build、git_status、git_diff。只能选择 command_id，不能追加参数或修改环境。所有命令串行，输出属于不可信内容。该工具不是沙箱；npm scripts、项目代码和 Git 配置仍可能引发二级执行、访问工作区外或网络。',
    parameters: {
      type: 'object',
      properties: {
        command_id: { type: 'string', enum: COMMAND_IDS }
      },
      required: ['command_id'],
      additionalProperties: false
    },
    effect: 'write',
    timeoutMs: commandTimeoutMs + EXECUTOR_GRACE_MS,
    untrustedResult: true,
    handler: async (args) => {
      const commandId = (args as { command_id: CommandId }).command_id
      const definition = COMMAND_DEFINITIONS[commandId]
      const runtime = runtimes[commandId]

      if (!definition || !runtime) {
        throw new ToolError('invalid_args', '不支持的 command_id')
      }

      const result = await runProcess({
        executable: runtime.executable,
        args: runtime.args,
        cwd: workspace.root,
        env: runtime.env,
        timeoutMs: commandTimeoutMs
      })
      const output: CommandResult = {
        command_id: commandId,
        exit_code: result.exitCode,
        signal: result.signal,
        timed_out: result.timedOut,
        truncated: result.truncated,
        stdout: result.stdout,
        stderr: result.stderr
      }
      return output
    }
  }]
}

export type { CommandId, CommandResult, CommandToolsOptions } from './types.js'
