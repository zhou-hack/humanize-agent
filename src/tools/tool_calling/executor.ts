import { failure, ToolError } from './errors.js'
import type { RegisteredTool, ToolRegistry } from './registry.js'
import type {
  ToolCall,
  ToolContext,
  ToolExecutorOptions,
  ToolResult
} from './types.js'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RESULT_CHARS = 16_000

export class ToolExecutor {
  private readonly timeoutMs: number
  private readonly maxResultChars: number
  private serialTail: Promise<void> = Promise.resolve()
  private writeQueueFailed = false

  constructor(
    private readonly registry: ToolRegistry,
    options: ToolExecutorOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxResultChars = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.registry.get(call.name)

    if (!tool) {
      return failure(new ToolError('unknown_tool', '工具不存在'))
    }

    if (!tool.validate(call.arguments)) {
      const issue = tool.validate.errors?.[0]
      const location = issue?.instancePath || '/'
      return failure(
        new ToolError('invalid_args', `参数校验失败: ${location} ${issue?.message ?? ''}`.trim())
      )
    }

    if (tool.definition.effect === 'read') {
      return this.run(tool, call, context)
    }
    if (this.writeQueueFailed) {
      return writeQueueFailure()
    }

    return this.runSerial(tool, call, context)
  }

  async executeBatch(calls: ToolCall[], context: ToolContext): Promise<ToolResult[]> {
    const results = new Array<ToolResult>(calls.length)
    let index = 0

    while (index < calls.length) {
      const call = calls[index]
      if (!call) {
        break
      }

      if (this.registry.get(call.name)?.definition.effect !== 'read') {
        results[index] = await this.execute(call, context)
        index += 1
        continue
      }

      const readIndexes: number[] = []
      const readCalls: ToolCall[] = []

      while (index < calls.length) {
        const readCall = calls[index]
        if (!readCall || this.registry.get(readCall.name)?.definition.effect !== 'read') {
          break
        }

        readIndexes.push(index)
        readCalls.push(readCall)
        index += 1
      }

      const readResults = await Promise.all(
        readCalls.map((readCall) => this.execute(readCall, context))
      )

      readIndexes.forEach((readIndex, resultIndex) => {
        results[readIndex] = readResults[resultIndex] as ToolResult
      })
    }

    return results
  }

  private runSerial(
    tool: RegisteredTool,
    call: ToolCall,
    context: ToolContext
  ): Promise<ToolResult> {
    const previous = this.serialTail
    let release = (): void => undefined
    this.serialTail = new Promise<void>((resolve) => {
      release = resolve
    })

    return previous.then(() => {
      if (this.writeQueueFailed) {
        release()
        return writeQueueFailure()
      }

      const pending = Promise.resolve().then(() =>
        tool.definition.handler(call.arguments, context)
      )
      pending.then(release, release)
      return this.waitForResult(pending, tool, context, () => {
        this.writeQueueFailed = true
        release()
      })
    })
  }

  private run(
    tool: RegisteredTool,
    call: ToolCall,
    context: ToolContext
  ): Promise<ToolResult> {
    const pending = Promise.resolve().then(() =>
      tool.definition.handler(call.arguments, context)
    )
    return this.waitForResult(pending, tool, context)
  }

  private async waitForResult(
    pending: Promise<unknown>,
    tool: RegisteredTool,
    context: ToolContext,
    onTimeout?: () => void
  ): Promise<ToolResult> {
    let timer: NodeJS.Timeout | undefined
    const isWrite = tool.definition.effect !== 'read'
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.()
        reject(
          new ToolError(
            'timeout',
            isWrite ? '工具执行超时，写入可能已经发生，请先读取确认状态' : '工具执行超时'
          )
        )
      }, tool.definition.timeoutMs ?? this.timeoutMs)
    })

    try {
      const data = await Promise.race([pending, timeout])
      const result = this.success(data)

      if (tool.definition.untrustedResult) {
        context.untrustedSeen = true
      }

      return result
    } catch (error) {
      return failure(error)
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  private success(data: unknown): ToolResult {
    let serialized: string | undefined

    try {
      serialized = JSON.stringify(data)
    } catch {
      throw new ToolError('internal', '工具结果无法序列化')
    }

    if (serialized === undefined) {
      return { ok: true, data: null }
    }

    if (Array.from(serialized).length <= this.maxResultChars) {
      return { ok: true, data }
    }

    return {
      ok: true,
      data: Array.from(serialized).slice(0, this.maxResultChars).join(''),
      truncated: true
    }
  }
}

function writeQueueFailure(): ToolResult {
  return failure(new ToolError(
    'timeout',
    '此前写工具超时，写队列已停用，请创建新的执行器后再试'
  ))
}
