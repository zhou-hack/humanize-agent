import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { createCliSession } from '../../cli/session.js'
import { createLlmSummarizer } from '../../cli/summarize.js'
import { createAnthropicClient, createOpenAIClient } from '../../llm/index.js'
import type { LlmClient } from '../../llm/types.js'
import { MemoryService } from '../../memory/index.js'
import { createLlmCommandJudge } from '../../tools/tool_calling/index.js'
import { createUiRuntime, type UiRuntime } from './app.js'
import { renderPrompt } from '../../prompt/loader.js'

const HOST = '127.0.0.1'
const PORT = 3210

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
    const commandJudge = createLlmCommandJudge({ llm })
    const model = (process.env.LLM_PROVIDER ?? 'anthropic') === 'openai'
      ? process.env.OPENAI_MODEL
      : process.env.ANTHROPIC_MODEL
    runtime = await createUiRuntime({
      memory: memoryService,
      ...(model ? { model } : {}),
      createSession: (requestApproval) => createCliSession({
        memory: memoryService,
        llm,
        requestApproval,
        commandJudge,
        system: renderPrompt('init/default-system', { platform: process.platform }),
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
