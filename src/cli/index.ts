import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { createAnthropicClient, createOpenAIClient } from '../llm/index.js'
import type { LlmClient } from '../llm/types.js'
import { MemoryService } from '../memory/index.js'
import { createLlmCommandJudge } from '../tools/tool_calling/index.js'
import { runRepl } from './repl.js'
import { createCliSession } from './session.js'
import { createLlmSummarizer } from './summarize.js'
import { renderPrompt } from '../prompt/loader.js'

async function main(): Promise<void> {
  let memory: MemoryService | undefined

  try {
    const envPath = resolve('.env')
    if (existsSync(envPath)) loadEnvFile(envPath)

    const provider = process.env.LLM_PROVIDER ?? 'anthropic'
    let llm: LlmClient
    if (provider === 'anthropic') {
      llm = createAnthropicClient({ envPath: false })
    } else if (provider === 'openai') {
      llm = createOpenAIClient({ envPath: false })
    } else {
      throw new Error('LLM_PROVIDER 必须是 anthropic 或 openai')
    }

    memory = new MemoryService({
      summarize: createLlmSummarizer(llm),
      onSummaryError: (error) => {
        printError('警告：会话总结失败', error)
      }
    })
    const memoryService = memory
    const commandJudge = createLlmCommandJudge({ llm })
    await runRepl({
      createSession: (requestApproval) => createCliSession({
        memory: memoryService,
        llm,
        requestApproval,
        commandJudge,
        system: renderPrompt('init/default-system', { platform: process.platform }),
        onBuiltinWarning: (message) => {
          process.stderr.write(`警告：${message}\n`)
        }
      }),
      input: process.stdin,
      output: process.stdout,
      error: process.stderr,
      terminal: process.stdin.isTTY ?? false
    })
  } catch (error) {
    printError('启动或运行失败', error)
    process.exitCode = 1
  } finally {
    if (memory) {
      try {
        await memory.close()
      } catch (error) {
        printError('关闭记忆服务失败', error)
        process.exitCode = 1
      }
    }
  }
}

function printError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : '未知错误'
  process.stderr.write(`${prefix}：${message}\n`)
}

await main()
