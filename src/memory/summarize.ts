// 闲置 1h 后台生成/增量更新 title + desc，只写库，不动上下文、不结束会话
// 使用与当前对话相同的模型

import type { StoredMessage } from './store'

export const IDLE_SUMMARIZE_MS = 60 * 60 * 1000

export interface Summary {
  title: string
  desc: string
}

const SUMMARIZE_PROMPT = `为这段对话生成索引信息，要求：
- title：不超过 20 字，包含关键实体（项目名/技术名/主题），禁止"技术讨论"这类泛泛标题
- desc：不超过 50 字，写结论和上下文，不复述过程；读者只看 desc 就能判断是否需要取全文
- 若提供了旧的 title/desc，结合新增消息更新，保留仍有效的结论`

/** previous 为空时首次总结；否则只传入 summarized_msg_id 之后的新消息做增量更新 */
export function summarizeConversation(
  _previous: Summary | null,
  _newMessages: StoredMessage[],
): Promise<Summary> {
  void SUMMARIZE_PROMPT
  // 1. newMessages 为空则跳过
  // 2. 拼 previous + newMessages + SUMMARIZE_PROMPT 调当前对话模型
  // 3. UPDATE conversations SET title, "desc", summarized_msg_id, summarized_at WHERE id = ...
  throw new Error('not implemented')
}
