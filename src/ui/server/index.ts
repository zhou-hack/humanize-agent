import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { createCliSession } from '../../cli/session.js'
import { createLlmSummarizer } from '../../cli/summarize.js'
import { KnowledgeService } from '../../knowledge/index.js'
import { MemoryService } from '../../memory/index.js'
import { loadBuiltin } from '../../tools/index.js'
import { createLlmCommandJudge } from '../../tools/tool_calling/index.js'
import { createUiRuntime, type UiRuntime } from './app.js'
import { ConnectionManager } from './connection.js'
import { renderPrompt } from '../../prompt/loader.js'

const HOST = '127.0.0.1'
const PORT = 3210

async function main(): Promise<void> {
  let memory: MemoryService | undefined
  let knowledge: KnowledgeService | undefined
  let runtime: UiRuntime | undefined
  try {
    const envPath = resolve('.env')
    if (existsSync(envPath)) loadEnvFile(envPath)
    const manager = new ConnectionManager()
    memory = new MemoryService({
      summarize: createLlmSummarizer(manager),
      onSummaryError: (error) => printError('警告：会话总结失败', error)
    })
    const memoryService = memory
    knowledge = new KnowledgeService()
    const knowledgeService = knowledge
    const commandJudge = createLlmCommandJudge({ llm: manager })
    const defaultSystem = renderPrompt('init/default-system', { platform: process.platform })
    const curationSystem = `${defaultSystem}\n${renderPrompt('init/event-curation')}`
    const builtin = await loadBuiltin({
      onWarning: (message) => {
        process.stderr.write(`警告：${message}\n`)
      }
    })
    try {
      runtime = await createUiRuntime({
        memory: memoryService,
        connection: manager,
        createSession: (requestApproval, mode) => createCliSession({
          memory: memoryService,
          knowledge: knowledgeService,
          llm: manager,
          requestApproval,
          commandJudge,
          builtin,
          memoryScope: mode === 'curation' ? 'ui:event-curation' : 'local',
          system: mode === 'curation' ? curationSystem : defaultSystem
        })
      })
    } catch (error) {
      await builtin.close()
      throw error
    }

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
      try {
        await knowledge?.close()
      } finally {
        await memory?.close()
      }
    }
    process.once('SIGINT', () => {
      void close().then(() => { process.exitCode = 0 })
    })
    process.once('SIGTERM', () => {
      void close().then(() => { process.exitCode = 0 })
    })
  } catch (error) {
    await runtime?.close().catch(() => undefined)
    await knowledge?.close().catch(() => undefined)
    await memory?.close().catch(() => undefined)
    printError('UI 启动或运行失败', error)
    process.exitCode = 1
  }
}

function printError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : '未知错误'
  process.stderr.write(`${prefix}：${message}\n`)
}

await main()
