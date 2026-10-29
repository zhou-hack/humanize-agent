import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentEvent } from '../../agent/index.js'
import type { CliSession } from '../../cli/session.js'
import { getConversationMessages, type Conversation, type MemoryService } from '../../memory/index.js'
import type {
  CommandApprovalHandler,
  CommandApprovalRequest
} from '../../tools/tool_calling/index.js'

const DEFAULT_STATIC_ROOT = fileURLToPath(new URL('../web/', import.meta.url))
const MAX_BODY_BYTES = 64 * 1024

type UiSession = Pick<CliSession, 'run' | 'snapshot' | 'cd' | 'setPermission' | 'close'>

export interface UiRuntimeOptions {
  memory: Pick<MemoryService, 'startNewConversation' | 'store'>
  createSession: (requestApproval: CommandApprovalHandler) => Promise<UiSession>
  staticRoot?: string
}

export interface UiRuntime {
  server: Server
  close: () => Promise<void>
}

interface ActiveRun {
  id: string
  controller: AbortController
  response: ServerResponse
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export async function createUiRuntime(options: UiRuntimeOptions): Promise<UiRuntime> {
  let active: ActiveRun | undefined
  let runStarting = false
  let archiving = false
  const pendingApprovals = new Map<string, (approved: boolean) => void>()

  const publish = (event: string, data: unknown): void => {
    if (active) writeEvent(active.response, event, data)
  }
  const rejectPendingApprovals = (): void => {
    for (const resolve of pendingApprovals.values()) resolve(false)
    pendingApprovals.clear()
  }
  const requestApproval: CommandApprovalHandler = (request: CommandApprovalRequest) => {
    if (!active) return Promise.resolve(false)
    const approvalId = randomUUID()
    publish('approval_request', { approvalId, ...request })
    return new Promise<boolean>((resolve) => {
      pendingApprovals.set(approvalId, resolve)
    })
  }
  const session = await options.createSession(requestApproval)
  const staticRoot = options.staticRoot ?? DEFAULT_STATIC_ROOT

  const state = (): Record<string, unknown> => ({
    ...session.snapshot(),
    running: active !== undefined || runStarting
  })

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/api/state' && request.method === 'GET') {
        sendJson(response, 200, state())
        return
      }
      if (url.pathname === '/api/history' && request.method === 'GET') {
        const limit = integerParam(url, 'limit', 20, 1, 50)
        const beforeValue = url.searchParams.get('before')
        const beforeId = url.searchParams.get('before_id')
        if ((beforeValue === null) !== (beforeId === null) || beforeId === '') {
          throw new HttpError(400, 'before 和 before_id 必须同时提供')
        }
        const before = beforeValue === null || beforeId === null
          ? undefined
          : { lastMessageAt: integerParam(url, 'before', 0, 0, Number.MAX_SAFE_INTEGER), id: beforeId }
        const rows = options.memory.store.listClosedConversations({ limit: limit + 1, ...(before ? { before } : {}) })
        const hasMore = rows.length > limit
        const conversations = rows.slice(0, limit)
        const last = conversations.at(-1)
        sendJson(response, 200, {
          conversations: conversations.map(historyConversation),
          has_more: hasMore,
          next_before: hasMore && last
            ? { last_message_at: last.lastMessageAt, id: last.id }
            : null
        })
        return
      }
      const historyMessagesMatch = /^\/api\/history\/([^/]+)\/messages$/.exec(url.pathname)
      if (historyMessagesMatch && request.method === 'GET') {
        let id: string
        try {
          id = decodeURIComponent(historyMessagesMatch[1] as string)
        } catch {
          throw new HttpError(400, '历史会话 ID 无效')
        }
        const conversation = options.memory.store.findConversation(id)
        if (!conversation || conversation.status !== 'closed') {
          throw new HttpError(404, '历史会话不存在')
        }
        const offset = integerParam(url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
        const limit = integerParam(url, 'limit', 50, 1, 100)
        sendJson(response, 200, {
          ...getConversationMessages(options.memory.store, id, offset, limit),
          conversation: historyConversation(conversation),
          read_only: true
        })
        return
      }
      if (url.pathname === '/api/directories' && request.method === 'GET') {
        const current = session.snapshot().workspace.current_directory
        sendJson(response, 200, await listDirectories(url.searchParams.get('path') ?? current, current))
        return
      }
      if (url.pathname === '/api/workspace' && request.method === 'POST') {
        if (active) throw new HttpError(409, '任务运行期间不能切换工作区')
        const body = await readJson(request)
        if (typeof body.path !== 'string' || !body.path.trim()) {
          throw new HttpError(400, 'path 不能为空')
        }
        sendJson(response, 200, {
          ...await session.cd(body.path.trim()),
          running: false
        })
        return
      }
      if (url.pathname === '/api/permission' && request.method === 'POST') {
        if (active) throw new HttpError(409, '任务运行期间不能切换权限')
        const body = await readJson(request)
        const mode = body.mode
        if (mode !== 'workspace' && mode !== 'approval') {
          throw new HttpError(400, 'mode 必须是 workspace 或 approval')
        }
        sendJson(response, 200, {
          ...await session.setPermission(mode),
          running: false
        })
        return
      }
      if (url.pathname === '/api/chat/new' && request.method === 'POST') {
        if (active || runStarting || archiving) {
          throw new HttpError(409, '任务运行或归档期间不能新建对话')
        }
        archiving = true
        try {
          await options.memory.startNewConversation()
          sendJson(response, 200, state())
        } finally {
          archiving = false
        }
        return
      }
      if (url.pathname === '/api/approvals' && request.method === 'POST') {
        const body = await readJson(request)
        if (typeof body.id !== 'string' || typeof body.approved !== 'boolean') {
          throw new HttpError(400, '审批参数无效')
        }
        const resolve = pendingApprovals.get(body.id)
        if (!resolve) throw new HttpError(404, '审批请求不存在或已处理')
        pendingApprovals.delete(body.id)
        resolve(body.approved)
        sendJson(response, 200, { ok: true })
        return
      }
      if (url.pathname === '/api/runs/stop' && request.method === 'POST') {
        const stopped = active !== undefined
        active?.controller.abort()
        rejectPendingApprovals()
        sendJson(response, 200, { stopped })
        return
      }
      if (url.pathname === '/api/runs' && request.method === 'POST') {
        if (active || runStarting || archiving) {
          throw new HttpError(409, '已有任务正在执行或归档')
        }
        runStarting = true
        try {
          const body = await readJson(request)
          if (typeof body.text !== 'string' || !body.text.trim()) {
            throw new HttpError(400, 'text 不能为空')
          }
          await runAgent({
            text: body.text.trim(),
            response,
            session,
            setActive: (run) => { active = run },
            clearActive: () => { active = undefined },
            publish,
            rejectPendingApprovals
          })
        } finally {
          runStarting = false
        }
        return
      }
      if (url.pathname.startsWith('/api/')) {
        throw new HttpError(404, 'API 不存在')
      }
      await serveStatic(request, response, staticRoot, url.pathname)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : '服务器内部错误'
      if (!response.headersSent) {
        sendJson(response, status, { error: message })
      } else if (!response.writableEnded) {
        response.end()
      }
    }
  })

  let closePromise: Promise<void> | undefined
  return {
    server,
    close: () => closePromise ??= (async () => {
      active?.controller.abort()
      rejectPendingApprovals()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(error)
          } else {
            resolve()
          }
        })
      })
      await session.close()
    })()
  }
}

interface RunAgentOptions {
  text: string
  response: ServerResponse
  session: UiSession
  setActive: (run: ActiveRun) => void
  clearActive: () => void
  publish: (event: string, data: unknown) => void
  rejectPendingApprovals: () => void
}

async function runAgent(options: RunAgentOptions): Promise<void> {
  const { response, session } = options
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  response.flushHeaders()

  const run: ActiveRun = {
    id: randomUUID(),
    controller: new AbortController(),
    response
  }
  options.setActive(run)
  let completed = false
  response.on('close', () => {
    if (!completed) {
      run.controller.abort()
      options.rejectPendingApprovals()
    }
  })

  options.publish('run_start', { runId: run.id })
  const onEvent = (event: AgentEvent): void => {
    switch (event.type) {
      case 'text_delta':
        options.publish('message_delta', { text: event.text })
        break
      case 'tool_call':
        options.publish('tool_call', {
          callId: event.call.id,
          name: event.call.name,
          args: event.call.arguments
        })
        break
      case 'tool_result':
        options.publish('tool_result', {
          callId: event.toolUseId,
          result: event.result
        })
        break
    }
  }

  try {
    const result = await session.run({
      text: options.text,
      signal: run.controller.signal,
      onEvent
    })
    options.publish('run_end', {
      status: 'done',
      usage: result.response.usage,
      truncated: result.truncated
    })
  } catch (error) {
    options.publish('run_end', {
      status: run.controller.signal.aborted ? 'aborted' : 'error',
      ...(error instanceof Error && !run.controller.signal.aborted
        ? { message: error.message }
        : {})
    })
  } finally {
    completed = true
    options.rejectPendingApprovals()
    options.clearActive()
    if (!response.writableEnded) response.end()
  }
}

async function listDirectories(input: string, current: string): Promise<Record<string, unknown>> {
  try {
    const canonical = await realpath(path.resolve(current, input))
    const info = await stat(canonical)
    if (!info.isDirectory()) throw new HttpError(400, '选择的路径不是目录')
    const children = await readdir(canonical, { withFileTypes: true })
    const directories = children
      .filter(child => child.isDirectory() && !child.isSymbolicLink() && !isPrivateDirectory(child.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 200)
      .map(child => ({ name: child.name, path: path.join(canonical, child.name) }))
    const parent = path.dirname(canonical)
    return {
      path: canonical,
      parent: parent === canonical ? null : parent,
      directories
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, '目录不存在或不可读')
  }
}

function isPrivateDirectory(name: string): boolean {
  return new Set(['.git', '.ssh', '.aws', '.gnupg']).has(name.toLowerCase())
}

function historyConversation(conversation: Conversation): Record<string, unknown> {
  return {
    id: conversation.id,
    title: conversation.title,
    desc: conversation.desc,
    status: conversation.status,
    created_at: conversation.createdAt,
    last_message_at: conversation.lastMessageAt,
    summarized_at: conversation.summarizedAt
  }
}

function integerParam(
  url: URL,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = url.searchParams.get(name)
  if (raw === null) return fallback
  if (!/^\d+$/u.test(raw)) throw new HttpError(400, `${name} 参数无效`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new HttpError(400, `${name} 参数无效`)
  }
  return value
}

function writeEvent(response: ServerResponse, event: string, data: unknown): void {
  if (!response.writableEnded) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(request.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
    throw new HttpError(415, '请求必须使用 application/json')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '请求体过大')
    chunks.push(buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new HttpError(400, 'JSON 请求体必须是对象')
    }
    return value as Record<string, unknown>
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'JSON 请求体无效')
  }
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  response.end(body)
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  pathname: string
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new HttpError(405, '静态资源仅支持 GET/HEAD')
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    throw new HttpError(400, '资源路径无效')
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const filename = path.resolve(root, relative)
  const relation = path.relative(root, filename)
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new HttpError(403, '资源路径越界')
  }

  let info
  try {
    info = await stat(filename)
  } catch {
    throw new HttpError(404, '页面或资源不存在，请先构建 UI')
  }
  if (!info.isFile()) throw new HttpError(404, '资源不存在')

  response.writeHead(200, {
    'Content-Type': contentType(filename),
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  })
  if (request.method === 'HEAD') {
    response.end()
  } else {
    createReadStream(filename).pipe(response)
  }
}

function contentType(filename: string): string {
  const extension = path.extname(filename).toLowerCase()
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  }[extension] ?? 'application/octet-stream'
}
