import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { createCliSession } from '../../cli/session.js'
import { createLlmSummarizer } from '../../cli/summarize.js'
import { createAnthropicClient, createOpenAIClient } from '../../llm/index.js'
import type { LlmClient } from '../../llm/types.js'
import { MemoryService } from '../../memory/index.js'
import { createUiRuntime, type UiRuntime } from './app.js'

const HOST = '127.0.0.1'
const PORT = 3210
const DEFAULT_SYSTEM = `你是 humanize-agent。当前平台：${process.platform}。使用用户的语言回答。
需要查看或修改工作区时优先使用专用工具，只有专用工具不足时才使用 shell，不要猜测文件内容。
查询路径是否存在使用 stat_path，按名称查找文件或目录使用 find_path。
只读查询禁止删除、移动、重命名或写入任何内容。
未经用户明确要求，不得访问或操作当前工作区之外的目录。`

async function main(): Promise<void> {
  let memory: MemoryService | undefined
  let runtime: UiRuntime | undefined
  try {
    const envPath = resolve('.env')
    if (existsSync(envPath)) loadEnvFile(envPath)
    const llm = createLlm()
    memory = new MemoryService({
      summarize: createLlmSummarizer(llm),
      onSummaryError: (error) => printError('警告：会话总结失败', error)
    })
    const memoryService = memory
    runtime = await createUiRuntime({
      memory: memoryService,
      createSession: (requestApproval) => createCliSession({
        memory: memoryService,
        llm,
        requestApproval,
        system: DEFAULT_SYSTEM,
        onBuiltinWarning: (message) => {
          process.stderr.write(`警告：${message}\n`)
        }
      })
    })

    await new Promise<void>((resolveListen, reject) => {
      runtime?.server.once('error', reject)
      runtime?.server.listen(PORT, HOST, () => resolveListen())
    })
    process.stdout.write(`Humanize Agent UI：http://${HOST}:${PORT}\n`)

    let closing = false
    const close = async (): Promise<void> => {
      if (closing) return
      closing = true
      await runtime?.close()
      await memory?.close()
    }
    process.once('SIGINT', () => {
      void close().then(() => { process.exitCode = 0 })
    })
    process.once('SIGTERM', () => {
      void close().then(() => { process.exitCode = 0 })
    })
  } catch (error) {
    await runtime?.close().catch(() => undefined)
    await memory?.close().catch(() => undefined)
    printError('UI 启动或运行失败', error)
    process.exitCode = 1
  }
}

function createLlm(): LlmClient {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  if (provider === 'anthropic') return createAnthropicClient({ envPath: false })
  if (provider === 'openai') return createOpenAIClient({ envPath: false })
  throw new Error('LLM_PROVIDER 必须是 anthropic 或 openai')
}

function printError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : '未知错误'
  process.stderr.write(`${prefix}：${message}\n`)
}

await main()
