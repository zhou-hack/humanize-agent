# LLM_OpenAI

## 概览

基于 OpenAI 官方 SDK，同时支持两种 API，并实现统一 `LlmClient` 接口：

| `OPENAI_API_MODE` | 实现 |
| --- | --- |
| `responses` | Responses API，默认模式 |
| `chat_completions` | Chat Completions API |

两种模式都支持普通调用、流式文本、函数工具、历史消息和受控错误。

## 环境配置

```text
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://your-openai-compatible-endpoint
OPENAI_MODEL=your-model
OPENAI_MAX_TOKENS=4096
OPENAI_API_MODE=responses
```

`OPENAI_BASE_URL`、`OPENAI_MAX_TOKENS` 和 `OPENAI_API_MODE` 可省略，默认使用 Responses。

显式 `apiMode` 参数优先于环境变量：

```ts
const client = createOpenAIClient({ apiMode: 'chat_completions' })
```

未知模式返回 `config` 错误，不会静默切换接口。

## Responses API

```ts
const response = await client.complete({
  system: '行为规则',
  messages: [{ role: 'user', content: '你好' }]
})
```

请求使用 `input`、`instructions`、`max_output_tokens`。系统提示词对应 `instructions`，函数工具结果对应 `function_call_output`。

流式文本来自 `response.output_text.delta`：

```ts
const response = await client.stream({
  messages: [{ role: 'user', content: '你好' }]
}, (delta) => process.stdout.write(delta))
```

## Chat Completions

设置 `OPENAI_API_MODE=chat_completions` 后，调用方式不变：

```ts
const response = await client.complete({
  system: '行为规则',
  messages: [{ role: 'user', content: '你好' }]
})
```

请求使用 `messages` 和 `max_completion_tokens`：

- `system` 转换为 system message。
- `tool_use` 转换为 assistant `tool_calls`。
- `tool_result` 转换为 role `tool` 和 `tool_call_id`。

流式使用官方 `chat.completions.stream`，通过 `content` 事件返回文本增量，并聚合最终完整响应。

## 统一响应

两种模式均返回：

- 文本 `text`。
- 工具调用 `tool_use`，参数已从 JSON 字符串解析。
- `stopReason`。
- `usage.inputTokens` 和 `usage.outputTokens`。

适配器不执行工具，调度仍由 `ToolExecutor` 负责。

## 受控错误

`OpenAIClientError` 提供 `code`、`retryable` 和可选 `status`，覆盖配置、认证、权限、参数、限流、超时、取消、网络及服务端错误。错误消息不包含响应正文或 API Key。
