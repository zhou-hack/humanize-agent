import type { LlmClient } from '../llm/types.js'
import type { ConversationSummarizer } from '../memory/summarize.js'

const SUMMARY_SYSTEM = `你负责维护会话摘要。根据旧摘要和增量消息生成最新摘要。
只返回 JSON 对象，不要输出 Markdown 或解释：
{"title":"包含主题和关键实体的简短标题","desc":"记录重要结论、决定和后续上下文的摘要"}
title 和 desc 都必须是非空字符串。`

export function createLlmSummarizer(llm: LlmClient): ConversationSummarizer {
  return async ({ title, desc, messages }) => {
    const response = await llm.complete({
      system: SUMMARY_SYSTEM,
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
