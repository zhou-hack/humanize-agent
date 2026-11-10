import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { createCliSession } from '../../cli/session.js'
import { createLlmSummarizer } from '../../cli/summarize.js'
import { parseBridgeLeaderIds } from '../../bridge/roles.js'
import { KnowledgeService } from '../../knowledge/index.js'
import { createAnthropicClient, createOpenAIClient } from '../../llm/index.js'
import type { LlmClient } from '../../llm/types.js'
import { MemoryService } from '../../memory/index.js'
import { renderPrompt } from '../../prompt/loader.js'
import { loadBuiltin, type LoadedBuiltin } from '../../tools/index.js'
import { createLlmCommandJudge } from '../../tools/tool_calling/index.js'
import { OneBotClient } from './client.js'
import { OneBotLogger } from './logger.js'
import { OneBotRouter } from './router.js'

async function main(): Promise<void> {
  let memory: MemoryService | undefined
  let knowledge: KnowledgeService | undefined
  let builtin: LoadedBuiltin | undefined
  let router: OneBotRouter | undefined
  let client: OneBotClient | undefined
  let closing = false

  const close = async (): Promise<void> => {
    if (closing) return
    closing = true
    await client?.close().catch((error) => printError('关闭 OneBot 连接失败', error))
    await router?.close().catch((error) => printError('关闭 QQ 会话失败', error))
    await builtin?.close().catch((error) => printError('关闭内置工具失败', error))
    await knowledge?.close().catch((error) => printError('关闭知识库失败', error))
    await memory?.close().catch((error) => printError('关闭记忆服务失败', error))
  }

  try {
    const envPath = resolve('.env')
    if (existsSync(envPath)) loadEnvFile(envPath)
    const llm = createLlm()
    const ownerId = parseOwnerId(process.env.ONEBOT_OWNER_QQ)
    const bridgeLeaderIds = parseBridgeLeaderIds(process.env.BRIDGE_LEADER_IDS)
    memory = new MemoryService({
      summarize: createLlmSummarizer(llm),
      onSummaryError: (error) => printError('警告：会话总结失败', error)
    })
    const memoryService = memory
    knowledge = new KnowledgeService()
    const knowledgeService = knowledge
    builtin = await loadBuiltin({
      onWarning: (message) => process.stderr.write(`警告：${message}\n`)
    })
    const loadedBuiltin = builtin
    const channelBuiltin: LoadedBuiltin = {
      tools: loadedBuiltin.tools,
      system: loadedBuiltin.system,
      close: async () => undefined
    }
    const commandJudge = createLlmCommandJudge({ llm })
    const logger = new OneBotLogger()

    router = new OneBotRouter({
      bridgeLeaderIds,
      createSession: (target) => createCliSession({
        memory: memoryService,
        knowledge: knowledgeService,
        llm,
        requestApproval: async () => false,
        commandJudge,
        system: renderPrompt('init/default-system', { platform: process.platform }),
        builtin: channelBuiltin,
        memoryScope: target.scope,
        allowCoreWrite: target.kind === 'private' && ownerId !== undefined && target.userId === ownerId,
        knowledgeAudience: target.audience
      }),
      sendText: (target, text) => {
        if (!client) return Promise.reject(new Error('OneBot 客户端尚未启动'))
        return target.kind === 'private'
          ? client.sendPrivateMessage(target.id, text)
          : client.sendGroupMessage(target.id, target.userId, text)
      },
      onError: (error, target) => {
        const prefix = target
          ? target.kind === 'private'
            ? `QQ 私聊处理失败（${target.userId}）`
            : `QQ 群聊处理失败（群 ${target.id}，成员 ${target.userId}）`
          : 'QQ 会话关闭失败'
        printError(prefix, error)
      },
      onReceive: (target, text) => logger.receive(target, text),
      onSend: (target, text) => logger.send(target, text),
      onAgentEvent: (scope, event) => logger.agentEvent(scope, event)
    })
    client = new OneBotClient({
      url: process.env.ONEBOT_WS_URL ?? 'ws://127.0.0.1:3001',
      accessToken: process.env.ONEBOT_ACCESS_TOKEN,
      onEvent: (event) => router?.handleEvent(event),
      onError: (error) => printError('OneBot 连接错误', error),
      onStatus: (status) => {
        process.stdout.write(status === 'connected'
          ? 'OneBot WebSocket 已连接，开始接收 QQ 私聊与群聊消息。\n'
          : 'OneBot WebSocket 已断开，将自动重连。\n')
      }
    })
    client.start()
    process.stdout.write('Humanize Agent QQ 消息服务已启动。\n')

    const handleSignal = (): void => {
      void close().then(() => {
        process.exitCode = 0
      })
    }
    process.once('SIGINT', handleSignal)
    process.once('SIGTERM', handleSignal)
  } catch (error) {
    printError('QQ 启动失败', error)
    process.exitCode = 1
    await close()
  }
}

function createLlm(): LlmClient {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  if (provider === 'anthropic') return createAnthropicClient({ envPath: false })
  if (provider === 'openai') return createOpenAIClient({ envPath: false })
  throw new Error('LLM_PROVIDER 必须是 anthropic 或 openai')
}

function parseOwnerId(value: string | undefined): number | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error('ONEBOT_OWNER_QQ 必须是正整数 QQ 号')
  }
  const ownerId = Number(normalized)
  if (!Number.isSafeInteger(ownerId)) throw new Error('ONEBOT_OWNER_QQ 超出安全整数范围')
  return ownerId
}

function printError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : '未知错误'
  process.stderr.write(`${prefix}：${message}\n`)
}

await main()
