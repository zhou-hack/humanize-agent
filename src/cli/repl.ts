import { createInterface } from 'node:readline'
import type { Agent, AgentEvent } from '../agent/index.js'

const HELP = '命令：/help 查看帮助，/exit 退出；运行中按 Ctrl+C 取消当前请求。\n'

export interface ReplOptions {
  agent: Pick<Agent, 'run'>
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  error?: NodeJS.WritableStream
  terminal?: boolean
}

export async function runRepl(options: ReplOptions): Promise<void> {
  const output = options.output
  const errorOutput = options.error ?? options.output
  const readline = createInterface({
    input: options.input,
    output,
    terminal: options.terminal ?? false
  })
  let activeController: AbortController | null = null
  let closed = false

  const onSigint = (): void => {
    if (activeController) {
      activeController.abort()
    } else {
      readline.close()
    }
  }
  const onClose = (): void => {
    closed = true
    if (options.terminal) activeController?.abort()
  }
  readline.on('SIGINT', onSigint)
  readline.on('close', onClose)
  readline.setPrompt('> ')

  try {
    output.write(`humanize-agent CLI\n${HELP}`)
    readline.prompt()

    for await (const line of readline) {
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
        const result = await options.agent.run({ text, signal: controller.signal, onEvent })
        closeText()
        if (result.truncated) {
          errorOutput.write('警告：回答可能被截断\n')
        }
      } catch (error) {
        closeText()
        if (controller.signal.aborted) {
          output.write('已取消当前请求\n')
        } else {
          const message = error instanceof Error ? error.message : '未知错误'
          errorOutput.write(`错误：${message}\n`)
        }
      } finally {
        activeController = null
      }

      if (!closed) readline.prompt()
    }
  } finally {
    readline.removeListener('SIGINT', onSigint)
    readline.removeListener('close', onClose)
    if (!closed) readline.close()
  }
}
