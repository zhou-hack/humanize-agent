import type { LlmClient } from '../../../llm/types.js'
import { renderPrompt } from '../../../prompt/loader.js'
import { ToolError } from '../errors.js'

export const DEFAULT_COMMAND_JUDGE_TIMEOUT_MS = 30_000

export interface CommandReviewRequest {
  command: string
  cwd: string
}

export interface CommandReview {
  readonly: boolean
  dangerous: boolean
}

export interface CommandJudge {
  timeoutMs: number
  review(request: CommandReviewRequest): Promise<CommandReview>
}

export interface LlmCommandJudgeOptions {
  llm: LlmClient
  timeoutMs?: number
  platform?: NodeJS.Platform
}

export function createLlmCommandJudge(options: LlmCommandJudgeOptions): CommandJudge {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_JUDGE_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('命令审核 timeoutMs 必须是正数')
  }
  const platform = options.platform ?? process.platform

  return {
    timeoutMs,
    async review(request) {
      const signal = AbortSignal.timeout(timeoutMs)
      let text: string
      try {
        const response = await options.llm.complete({
          system: buildJudgePrompt(request.cwd, platform),
          messages: [{ role: 'user', content: request.command }],
          signal
        })
        text = response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('')
      } catch (error) {
        if (signal.aborted) {
          throw new ToolError('timeout', '命令安全审核超时，已拒绝执行')
        }
        const reason = error instanceof Error && error.message ? `（${error.message}）` : ''
        throw new ToolError('internal', `命令安全审核服务调用失败${reason}，已拒绝执行`, true)
      }
      return parseVerdict(text, request.command)
    }
  }
}

export function buildJudgePrompt(cwd: string, platform: NodeJS.Platform): string {
  const shell = platform === 'win32' ? 'Windows cmd.exe' : '/bin/sh'
  return renderPrompt('task/command-judge', { shell, cwd })
}

export function parseVerdict(text: string, command: string): CommandReview {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim()

  const candidates = cleaned.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .reverse()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(cleaned.slice(first, last + 1))

  for (const candidate of candidates) {
    let value: unknown
    try {
      value = JSON.parse(candidate)
    } catch {
      continue
    }
    if (
      typeof value !== 'object' || value === null ||
      typeof (value as Record<string, unknown>).readonly !== 'boolean' ||
      typeof (value as Record<string, unknown>).dangerous !== 'boolean'
    ) {
      continue
    }
    const verdict = value as { command?: unknown; readonly: boolean; dangerous: boolean }
    // 回显的命令与原文不一致说明判定对象被篡改或误读，按失败处理。
    if (verdict.command !== command) {
      throw new ToolError('internal', '命令安全审核结果与原命令不一致，已拒绝执行', true)
    }
    return { readonly: verdict.readonly, dangerous: verdict.dangerous }
  }
  throw new ToolError('internal', '命令安全审核返回了无效结果，已拒绝执行', true)
}
