# LLM_Anthropic

## 概览

基于 Anthropic 官方 SDK 的 Messages API 适配器，实现统一 `LlmClient` 接口：

- 普通消息请求。
- 流式文本增量及最终完整响应。
- 系统提示词和多轮消息转换。
- 工具 JSON Schema、`tool_use`、`tool_result` 转换。
- 环境配置和受控错误。

## 环境配置

默认读取当前目录的 `.env`，支持：

```text
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_BASE_URL=https://your-anthropic-compatible-endpoint
ANTHROPIC_MODEL=your-model
ANTHROPIC_MAX_TOKENS=4096
```

`ANTHROPIC_BASE_URL` 和 `ANTHROPIC_MAX_TOKENS` 可省略。也可以通过 `createAnthropicClient` 参数显式覆盖；`envPath: false` 可关闭 `.env` 加载。

## 普通调用

```ts
import { createAnthropicClient } from '../index.js'

const client = createAnthropicClient()
const response = await client.complete({
  system: '行为规则',
  messages: [{ role: 'user', content: '你好' }]
})

console.log(response.content)
```

## 流式调用

```ts
const response = await client.stream({
  messages: [{ role: 'user', content: '你好' }]
}, (delta) => {
  process.stdout.write(delta)
})
```

文本通过回调增量返回，Promise 最终返回包含工具调用和 Token 用量的完整 `LlmResponse`。

## 工具调用

请求中的 `tools` 直接使用 `tool_calling` 的 `ToolDefinition[]`，适配器只发送 `name`、`description` 和 `parameters`：

```ts
const response = await client.complete({
  messages,
  tools: registry.list()
})
```

模型返回的工具调用位于 `response.content`，类型为 `tool_use`。执行后作为下一条 user 消息的 `tool_result` 内容传回：

```ts
{
  role: 'user',
  content: [{
    type: 'tool_result',
    toolUseId: 'tool-call-id',
    content: JSON.stringify(toolResult)
  }]
}
```

适配器不执行工具，工具调度仍由 `ToolExecutor` 负责。

## 受控错误

`AnthropicClientError` 提供 `code`、`retryable` 和可选 `status`：

- `config`：缺少模型、API Key 或配置无效。
- `authentication`、`permission`、`not_found`、`invalid_request`：请求或权限错误。
- `rate_limit`、`timeout`、`network`：可重试错误。
- `aborted`：通过 `AbortSignal` 取消。
- `api`：其他服务端或未知错误。

错误消息不包含响应正文、请求头或 API Key。
