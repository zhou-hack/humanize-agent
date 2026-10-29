import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  type StdioServerParameters
} from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Ajv } from 'ajv'
import type { ToolDefinition } from '../tool_calling/types.js'

const DEFAULT_TIMEOUT_MS = 30_000
const EXECUTOR_GRACE_MS = 5_000
const EXPOSED_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const ENV_REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

export interface McpServerManifest {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

export interface ResolvedMcpServer {
  id: string
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  timeoutMs: number
}

export type McpTransportFactory = (
  server: ResolvedMcpServer
) => Transport | Promise<Transport>

export interface BuiltinMcpOptions {
  onWarning?: (message: string) => void
  transportFactory?: McpTransportFactory
}

export interface LoadedBuiltinMcp {
  tools: ToolDefinition[]
  close: () => Promise<void>
}

export async function loadBuiltinMcp(
  root: string,
  options: BuiltinMcpOptions = {}
): Promise<LoadedBuiltinMcp> {
  const manifestPath = path.resolve(root, 'servers.json')
  const manifest = await readManifest(manifestPath)
  if (manifest === undefined) return emptyResult()
  if (!isRecord(manifest) || !isRecord(manifest.servers)) {
    throw new TypeError('MCP 清单必须包含 servers 对象')
  }

  const rootDirectory = path.dirname(manifestPath)
  const clients: Array<{ id: string; client: Client }> = []
  const tools: ToolDefinition[] = []
  const exposedNames = new Set<string>()
  const warn = (message: string): void => {
    try {
      options.onWarning?.(message)
    } catch {
      // 告警回调不能中断其余服务器的加载或清理。
    }
  }

  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (!closePromise) {
      closePromise = closeAll(clients, warn)
    }
    return closePromise
  }

  for (const [id, value] of Object.entries(manifest.servers)) {
    const client = new Client(
      { name: 'humanize-agent', version: '0.1.0' },
      { capabilities: {} }
    )

    try {
      const server = resolveServer(id, value, rootDirectory)
      const transport = options.transportFactory
        ? await options.transportFactory(server)
        : createStdioTransport(server)

      await client.connect(transport, {
        timeout: server.timeoutMs,
        maxTotalTimeout: server.timeoutMs
      })

      const discovered = await discoverTools(client, server)
      const staged: ToolDefinition[] = []
      const stagedNames = new Set<string>()

      for (const tool of discovered) {
        const exposedName = `mcp__${server.id}__${tool.name}`
        if (!EXPOSED_NAME_PATTERN.test(exposedName)) {
          throw new TypeError('MCP 工具暴露名称非法')
        }
        if (exposedNames.has(exposedName) || stagedNames.has(exposedName)) {
          throw new TypeError('MCP 工具暴露名称冲突')
        }
        validateInputSchema(tool.inputSchema)

        const remoteName = tool.name
        const timeoutMs = server.timeoutMs
        staged.push({
          name: exposedName,
          description: tool.description ?? `MCP 工具 ${server.id}/${remoteName}`,
          parameters: tool.inputSchema,
          effect: tool.annotations?.readOnlyHint === true ? 'read' : 'write',
          timeoutMs: timeoutMs + EXECUTOR_GRACE_MS,
          untrustedResult: true,
          handler: async (args) => client.callTool(
            { name: remoteName, arguments: args as Record<string, unknown> },
            undefined,
            { timeout: timeoutMs, maxTotalTimeout: timeoutMs }
          )
        })
        stagedNames.add(exposedName)
      }

      clients.push({ id: server.id, client })
      for (const tool of staged) {
        tools.push(tool)
        exposedNames.add(tool.name)
      }
    } catch {
      try {
        await client.close()
      } catch {
        // 加载失败时仍继续处理其他服务器。
      }
      warn(`MCP 服务器 ${JSON.stringify(id)} 加载失败，已跳过`)
    }
  }

  return { tools, close }
}

function emptyResult(): LoadedBuiltinMcp {
  let closed: Promise<void> | undefined
  return {
    tools: [],
    close: () => {
      closed ??= Promise.resolve()
      return closed
    }
  }
}

async function closeAll(
  clients: Array<{ id: string; client: Client }>,
  warn: (message: string) => void
): Promise<void> {
  const pending = clients.splice(0)
  for (const { id, client } of pending) {
    try {
      await client.close()
    } catch {
      warn(`MCP 服务器 ${JSON.stringify(id)} 关闭失败`)
    }
  }
}

function createStdioTransport(server: ResolvedMcpServer): StdioClientTransport {
  const parameters: StdioServerParameters = {
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    ...(server.env ? { env: server.env } : {})
  }
  return new StdioClientTransport(parameters)
}

async function readManifest(manifestPath: string): Promise<unknown | undefined> {
  let source: string
  try {
    source = await readFile(manifestPath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    throw new Error('无法读取 MCP 清单')
  }

  if (!source.trim()) return undefined
  try {
    return JSON.parse(source) as unknown
  } catch {
    throw new SyntaxError('MCP 清单 JSON 语法错误')
  }
}

function resolveServer(
  id: string,
  value: unknown,
  rootDirectory: string
): ResolvedMcpServer {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new TypeError('MCP 服务器 ID 非法')
  if (!isRecord(value)) throw new TypeError('MCP 服务器配置必须是对象')
  if (value.transport !== undefined && value.transport !== 'stdio') {
    throw new TypeError('MCP 仅支持 stdio 传输')
  }
  if (value.type !== undefined && value.type !== 'stdio') {
    throw new TypeError('MCP 仅支持 stdio 传输')
  }
  if (typeof value.command !== 'string' || !value.command.trim()) {
    throw new TypeError('MCP 服务器必须提供 command')
  }

  const args = value.args ?? []
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    throw new TypeError('MCP args 必须是字符串数组')
  }
  if (value.cwd !== undefined && typeof value.cwd !== 'string') {
    throw new TypeError('MCP cwd 必须是字符串')
  }

  const timeoutMs = value.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) <= 0) {
    throw new TypeError('MCP timeoutMs 必须是正整数')
  }

  return {
    id,
    command: value.command,
    args: [...args],
    cwd: path.resolve(rootDirectory, (value.cwd as string | undefined) ?? '.'),
    ...(value.env !== undefined ? { env: resolveEnvironment(value.env) } : {}),
    timeoutMs: timeoutMs as number
  }
}

function resolveEnvironment(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new TypeError('MCP env 必须是对象')

  const resolved: Record<string, string> = {}
  for (const [name, input] of Object.entries(value)) {
    if (typeof input !== 'string') throw new TypeError('MCP env 值必须是字符串')
    resolved[name] = input.replace(
      ENV_REFERENCE_PATTERN,
      (_match, variable: string) => process.env[variable] ?? ''
    )
  }
  return resolved
}

async function discoverTools(
  client: Client,
  server: ResolvedMcpServer
): Promise<Awaited<ReturnType<Client['listTools']>>['tools']> {
  const tools: Awaited<ReturnType<Client['listTools']>>['tools'] = []
  let cursor: string | undefined
  const cursors = new Set<string>()

  do {
    const page = await client.listTools(
      cursor === undefined ? undefined : { cursor },
      { timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs }
    )
    tools.push(...page.tools)
    cursor = page.nextCursor
    if (cursor !== undefined) {
      if (cursors.has(cursor)) throw new Error('MCP 工具分页游标重复')
      cursors.add(cursor)
    }
  } while (cursor !== undefined)

  return tools
}

function validateInputSchema(schema: unknown): asserts schema is Record<string, unknown> {
  if (!isRecord(schema) || schema.type !== 'object') {
    throw new TypeError('MCP 工具 inputSchema 必须是对象 schema')
  }
  new Ajv({ strict: true }).compile(schema)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}
