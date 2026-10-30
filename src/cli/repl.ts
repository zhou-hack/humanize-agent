import { createInterface } from 'node:readline'
import type { AgentEvent } from '../agent/index.js'
import type { CommandApprovalHandler } from '../tools/tool_calling/index.js'
import type { CliSession, CliSnapshot } from './session.js'

const HELP = `命令：
/help 查看帮助
/cd <路径> 切换工作区（目录必须已存在），无参显示当前工作区
/permission [workspace|approval] 无参切换，带参设置权限；open 暂未开放
/exit 退出
运行中按 Ctrl+C 取消当前请求。
`

export type ReplSession = Pick<CliSession, 'run' | 'snapshot' | 'cd' | 'setPermission' | 'close'>

export interface ReplOptions {
  createSession: (requestApproval: CommandApprovalHandler) => ReplSession | Promise<ReplSession>
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  error?: NodeJS.WritableStream
  terminal?: boolean
}

interface LineWaiter {
  resolve: (line: string | null) => void
  onAbort: () => void
}

class LineQueue {
  private readonly lines: string[] = []
  private readonly waiters: LineWaiter[] = []
  private closed = false

  push(line: string): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve(line)
    } else {
      this.lines.push(line)
    }
  }

  next(signal?: AbortSignal): Promise<string | null> {
    const line = this.lines.shift()
    if (line !== undefined) return Promise.resolve(line)
    if (this.closed || signal?.aborted) return Promise.resolve(null)

    return new Promise((resolve) => {
      let waiter: LineWaiter
      const cleanup = (): void => {
        signal?.removeEventListener('abort', waiter.onAbort)
      }
      waiter = {
        resolve: (nextLine) => {
          cleanup()
          resolve(nextLine)
        },
        onAbort: () => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          cleanup()
          resolve(null)
        }
      }
      this.waiters.push(waiter)
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
    })
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve(null)
    }
  }
}

export async function runRepl(options: ReplOptions): Promise<void> {
  const output = options.output
  const errorOutput = options.error ?? options.output
  const readline = createInterface({
    input: options.input,
    output,
    terminal: options.terminal ?? false
  })
  const queue = new LineQueue()
  let activeController: AbortController | null = null
  let closed = false

  const onLine = (line: string): void => queue.push(line)
  const onSigint = (): void => {
    if (activeController) {
      activeController.abort()
    } else {
      readline.close()
    }
  }
  const onClose = (): void => {
    closed = true
    queue.close()
    if (options.terminal) activeController?.abort()
  }
  readline.on('line', onLine)
  readline.on('SIGINT', onSigint)
  readline.on('close', onClose)
  readline.setPrompt('> ')

  const requestApproval: CommandApprovalHandler = async ({ command, cwd, risk }) => {
    output.write(`审批请求\n命令: ${command}\n目录: ${cwd}\n`)
    if (risk === 'destructive') {
      output.write('高风险：可能删除、移动或重命名文件，请核对命令和目录。\n')
    }
    output.write('允许执行？输入 y/yes 批准，其他输入拒绝：\n')
    const answer = await queue.next(activeController?.signal)
    const normalized = answer?.trim().toLowerCase()
    return normalized === 'y' || normalized === 'yes'
  }

  let session: ReplSession | undefined
  try {
    session = await options.createSession(requestApproval)
    output.write(`humanize-agent CLI\n${HELP}`)
    writeSnapshot(output, session.snapshot())
    if (!closed) readline.prompt()

    while (true) {
      const line = await queue.next()
      if (line === null) break
      const text = line.trim()
      if (!text) {
        if (!closed) readline.prompt()
        continue
      }
      if (text === '/exit') break
      if (text === '/help') {
        output.write(HELP)
        if (!closed) readline.prompt()
        continue
      }
      if (text === '/cd' || text.startsWith('/cd ')) {
        try {
          const directory = text.slice('/cd'.length).trim()
          const snapshot = directory ? await session.cd(directory) : session.snapshot()
          writeSnapshot(output, snapshot)
        } catch (error) {
          writeError(errorOutput, error)
        }
        if (!closed) readline.prompt()
        continue
      }
      if (text === '/permission' || text.startsWith('/permission ')) {
        try {
          const mode = text.slice('/permission'.length).trim()
          const snapshot = await session.setPermission(mode || undefined)
          output.write(`权限: ${snapshot.permission}\n`)
        } catch (error) {
          writeError(errorOutput, error)
        }
        if (!closed) readline.prompt()
        continue
      }

      const controller = new AbortController()
      activeController = controller
      const toolNames = new Map<string, string>()
      let textOpen = false

      const closeText = (): void => {
        if (!textOpen) return
        output.write('\n')
        textOpen = false
      }
      const writeTool = (text: string): void => {
        closeText()
        output.write(`工具: ${text}\n`)
      }
      const onEvent = (event: AgentEvent): void => {
        if (event.type === 'thinking_delta') return
        if (event.type === 'text_delta') {
          if (!textOpen) {
            output.write('助手: ')
            textOpen = true
          }
          output.write(event.text)
          return
        }
        if (event.type === 'tool_call') {
          toolNames.set(event.call.id, event.call.name)
          writeTool(`${event.call.name} 开始`)
          return
        }
        const name = toolNames.get(event.toolUseId) ?? event.toolUseId
        writeTool(`${name} ${event.result.ok ? '成功' : '失败'}`)
      }

      try {
        const result = await session.run({ text, signal: controller.signal, onEvent })
        closeText()
        if (result.truncated) {
          errorOutput.write('警告：回答可能被截断\n')
        }
      } catch (error) {
        const wasAborted = controller.signal.aborted
        if (!wasAborted) controller.abort()
        closeText()
        if (wasAborted) {
          output.write('已取消当前请求\n')
        } else {
          writeError(errorOutput, error)
        }
      } finally {
        activeController = null
      }

      if (!closed) readline.prompt()
    }
  } finally {
    readline.removeListener('line', onLine)
    readline.removeListener('SIGINT', onSigint)
    readline.removeListener('close', onClose)
    if (!closed) readline.close()
    queue.close()
    await session?.close()
  }
}

function writeSnapshot(output: NodeJS.WritableStream, snapshot: CliSnapshot): void {
  output.write(`工作区: ${snapshot.workspace.current_directory}\n`)
  output.write(`权限: ${snapshot.permission}\n`)
}

function writeError(output: NodeJS.WritableStream, error: unknown): void {
  const message = error instanceof Error ? error.message : '未知错误'
  output.write(`错误：${message}\n`)
}
