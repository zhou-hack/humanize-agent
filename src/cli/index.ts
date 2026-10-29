import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { createAnthropicClient, createOpenAIClient } from '../llm/index.js'
import type { LlmClient } from '../llm/types.js'
import { MemoryService } from '../memory/index.js'
import { runRepl } from './repl.js'
import { createCliSession } from './session.js'
import { createLlmSummarizer } from './summarize.js'

const DEFAULT_SYSTEM = `你是 humanize-agent。当前平台：${process.platform}。使用用户的语言回答。
需要查看或修改工作区时优先使用专用工具，只有专用工具不足时才使用 shell，不要猜测文件内容。
查询路径是否存在使用 stat_path，按名称查找文件或目录使用 find_path。
只读查询禁止删除、移动、重命名或写入任何内容。
未经用户明确要求，不得访问或操作当前工作区之外的目录。`

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
    await runRepl({
      createSession: (requestApproval) => createCliSession({
        memory: memoryService,
        llm,
        requestApproval,
        system: DEFAULT_SYSTEM,
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
