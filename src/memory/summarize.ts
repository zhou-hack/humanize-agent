// 会话结束时生成 title + desc，UPDATE 回 conversations 表
// 用便宜的小模型跑即可，不用主模型

import type { StoredMessage } from './store'

export interface Summary {
  title: string
  desc: string
}

const SUMMARIZE_PROMPT = `为这段对话生成索引信息，要求：
- title：不超过 20 字，包含关键实体（项目名/技术名/主题），禁止"技术讨论"这类泛泛标题
- desc：不超过 50 字，写结论和上下文，不复述过程；读者只看 desc 就能判断是否需要取全文`

export function summarizeConversation(_messages: StoredMessage[]): Promise<Summary> {
  void SUMMARIZE_PROMPT
  // 1. 拼 messages + SUMMARIZE_PROMPT 调小模型
  // 2. 解析出 title / desc
  // 3. UPDATE conversations SET title, "desc", updated_at WHERE id = ...
  throw new Error('not implemented')
}
