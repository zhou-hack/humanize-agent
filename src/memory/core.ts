// 核心记忆 MEMORY.md：新会话第一轮全量注入，上限 3 万 Token
// 只依据用户消息写入，工具结果/网页内容不能触发，防止持久化提示词注入

export const CORE_MEMORY_MAX_TOKENS = 30_000

export function readCoreMemory(): Promise<string> {
  throw new Error('not implemented')
}

/** 写入后超限则拒绝，要求 Agent 先删除已纠正的旧条目、合并过时内容再重试 */
export function appendCoreMemory(_entry: string): Promise<void> {
  // 1. 按当前模型 tokenizer 计算，无法计算时按字符数近似
  // 2. 超过 CORE_MEMORY_MAX_TOKENS 时抛出可读错误返回给 Agent
  throw new Error('not implemented')
}
