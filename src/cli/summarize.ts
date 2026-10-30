import type { LlmClient } from '../llm/types.js'
import type { ConversationSummarizer } from '../memory/summarize.js'
import { renderPrompt } from '../prompt/loader.js'

export function createLlmSummarizer(llm: LlmClient): ConversationSummarizer {
  return async ({ title, desc, messages }) => {
    const response = await llm.complete({
      system: renderPrompt('task/summarize'),
      messages: [{
        role: 'user',
        content: JSON.stringify({ title, desc, messages })
      }]
    })
    const text = response.content
      .flatMap((block) => block.type === 'text' ? [block.text] : [])
      .join('\n')
      .trim()
    const parsed = JSON.parse(text) as unknown

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('会话总结必须是 JSON 对象')
    }
    const record = parsed as Record<string, unknown>
    if (typeof record.title !== 'string' || typeof record.desc !== 'string') {
      throw new Error('会话总结必须包含字符串 title 和 desc')
    }

    const nextTitle = record.title.trim()
    const nextDesc = record.desc.trim()
    if (!nextTitle || !nextDesc) {
      throw new Error('会话总结必须包含非空 title 和 desc')
    }
    return { title: nextTitle, desc: nextDesc }
  }
}
