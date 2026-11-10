import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { parseBridgeLeaderIds } from '../../bridge/roles.js'
import { createCliSession } from '../../cli/session.js'
import { createLlmSummarizer } from '../../cli/summarize.js'
import { KnowledgeService } from '../../knowledge/index.js'
import { createAnthropicClient, createOpenAIClient } from '../../llm/index.js'
import type { LlmClient } from '../../llm/types.js'
import { MemoryService } from '../../memory/index.js'
import { renderPrompt } from '../../prompt/loader.js'
import { loadBuiltin, type LoadedBuiltin } from '../../tools/index.js'
import { createLlmCommandJudge } from '../../tools/tool_calling/index.js'
import { ILinkClient, ILinkRequestError } from './client.js'
import { parseILinkAllow, resolveILinkStatePath } from './config.js'
import { loginILink } from './login.js'
import { ILinkLogger } from './logger.js'
import { ILinkPoller } from './poller.js'
import { ILinkRouter } from './router.js'
import {
  assertILinkLoginState,
  hasLogin,
  ILinkStateStore
} from './state.js'

async function main(): Promise<void> {
  const controller = new AbortController()
  let memory: MemoryService | undefined
  let knowledge: KnowledgeService | undefined
  let builtin: LoadedBuiltin | undefined
  let router: ILinkRouter | undefined
  let client: ILinkClient | undefined
  let closePromise: Promise<void> | undefined

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      controller.abort()
      await router?.close().catch(error => printError('关闭微信会话失败', error))
      client?.close()
      await builtin?.close().catch(error => printError('关闭内置工具失败', error))
      await knowledge?.close().catch(error => printError('关闭知识库失败', error))
      await memory?.close().catch(error => printError('关闭记忆服务失败', error))
    })()
    return closePromise
  }

  const handleSignal = (): void => controller.abort()
  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)

  try {
    const envPath = resolve('.env')
    if (existsSync(envPath)) loadEnvFile(envPath)
    const allowedUserIds = parseILinkAllow(process.env.ILINK_ALLOW)
    const bridgeLeaderIds = parseBridgeLeaderIds(process.env.BRIDGE_LEADER_IDS)
    const store = new ILinkStateStore({
      path: resolveILinkStatePath(process.env.ILINK_STATE)
    })
    client = new ILinkClient()
    const initialState = await store.load()
    const login = hasLogin(initialState)
      ? initialState
      : await loginILink({ client, store, signal: controller.signal })
    process.stdout.write(`[link] owner_id=${login.owner_id} bot_id=${login.bot_id}\n`)

    const llm = createLlm()
    memory = new MemoryService({
      summarize: createLlmSummarizer(llm),
      onSummaryError: error => printError('警告：会话总结失败', error)
    })
    const memoryService = memory
    knowledge = new KnowledgeService()
    const knowledgeService = knowledge
    builtin = await loadBuiltin({
      onWarning: message => process.stderr.write(`警告：${message}\n`)
    })
    const loadedBuiltin = builtin
    const channelBuiltin: LoadedBuiltin = {
      tools: loadedBuiltin.tools,
      system: loadedBuiltin.system,
      close: async () => undefined
    }
    const commandJudge = createLlmCommandJudge({ llm })
    const logger = new ILinkLogger()

    router = new ILinkRouter({
      ownerId: login.owner_id,
      allowedUserIds,
      bridgeLeaderIds,
      initialProcessedMessageIds: login.processed_message_ids,
      persistMessage: async message => {
        await store.update(current => {
          if (!current.processed_message_ids.includes(message.message_id)) {
            current.processed_message_ids.push(message.message_id)
          }
          current.context_tokens[message.from_user_id] = message.context_token
        })
      },
      createSession: target => createCliSession({
        memory: memoryService,
        knowledge: knowledgeService,
        llm,
        requestApproval: async () => false,
        commandJudge,
        system: renderPrompt('init/default-system', { platform: process.platform }),
        builtin: channelBuiltin,
        memoryScope: target.scope,
        allowCoreWrite: false,
        knowledgeAudience: target.audience
      }),
      sendText: async (target, text) => {
        const current = store.snapshot
        assertILinkLoginState(current)
        await client?.sendText({
          token: current.bot_token,
          baseUrl: current.baseurl,
          toUserId: target.userId,
          getContextToken: () => store.snapshot.context_tokens[target.userId] ?? '',
          text,
          signal: controller.signal
        })
      },
      onError: (error, target) => {
        printError(target ? `微信私聊处理失败（${target.userId}）` : '微信会话关闭失败', error)
      },
      onReceive: (target, text) => logger.receive(target, text),
      onSend: (target, text) => logger.send(target, text),
      onAgentEvent: (scope, event) => logger.agentEvent(scope, event)
    })

    const activeRouter = router
    const poller = new ILinkPoller({
      client,
      store,
      router: activeRouter,
      signal: controller.signal,
      onError: error => printError('iLink 收消息失败', error),
      onPause: () => {
        process.stderr.write('iLink 会话失效（-14），暂停请求 1 小时；持续失效时请重新扫码。\n')
      }
    })
    process.stdout.write('Humanize Agent 微信私聊服务已启动，开始接收 iLink 消息。\n')
    await poller.run()
  } catch (error) {
    if (controller.signal.aborted || (error instanceof ILinkRequestError && error.kind === 'abort')) {
      process.exitCode = 0
    } else {
      printError('微信 iLink Bot 启动失败', error)
      process.exitCode = 1
    }
  } finally {
    process.removeListener('SIGINT', handleSignal)
    process.removeListener('SIGTERM', handleSignal)
    await close()
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
