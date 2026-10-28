# 项目概览

> 最后更新：2026-10-28

## 定位

humanize-agent 是一个专注长期记忆的 Agent。核心目标不是堆砌工具数量，而是让 Agent 在持续交互中记住有价值的信息，并在之后的对话里自然地用上。

当前处于基础模块搭建阶段：记忆、工具调用、LLM 适配三大底层模块已完成并通过真实 API 验证，但还没有把它们串起来的 Agent 主循环，因此暂时无法作为一个完整产品直接对话使用。

## 技术栈

- 语言：TypeScript（ES2022、NodeNext ESM、strict 模式）
- 运行时：Node.js >= 22.13（记忆模块依赖内置 `node:sqlite`）
- 存储：SQLite（FTS5 trigram 全文索引）+ `MEMORY.md` 文件
- LLM SDK：`@anthropic-ai/sdk`、`openai`（均为官方 SDK）
- 参数校验：Ajv
- 测试：Vitest

## 目录结构

```text
src/
├── agent/                  # Agent 主循环，下一步实现
├── llm/                    # LLM 适配层，已完成
│   ├── types.ts            #   统一 LlmClient / LlmRequest / LlmResponse 协议
│   ├── anthropic/          #   Anthropic Messages API 适配器
│   └── openai/             #   OpenAI Responses + Chat Completions 适配器
├── tools/
│   └── tool_calling/       # 工具调用层，已完成
│       ├── registry.ts     #   工具注册与 Ajv 参数校验
│       ├── executor.ts     #   调度、超时、读写串行屏障、结果截断
│       ├── file_tools/     #   工作区文件工具
│       ├── command_tools/  #   三档权限的 shell 命令工具
│       └── workspace_manager.ts  # 默认目录与选择目录管理
├── memory/                 # 记忆模块，已完成
│   ├── store.ts            #   SQLite schema、会话与消息读写、FTS5 索引
│   ├── core.ts             #   MEMORY.md 核心记忆读写与容量控制
│   ├── recent.ts           #   近 3 天会话索引
│   ├── search.ts           #   长期记忆检索与时间分页
│   ├── summarize.ts        #   闲置增量总结
│   ├── media.ts            #   表情包保存与检索
│   ├── tools.ts            #   8 个原生记忆工具
│   └── index.ts            #   MemoryService 统一入口
├── sandbox/                # OS 沙箱，暂缓
└── data/                   # 运行时数据，不提交 Git
    ├── memory/             #   MEMORY.md 与 memory.db
    ├── multimedia/         #   表情包等多媒体文件
    └── tools/              #   外置用户自定义 MCP / Skill
```

## 模块进度

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 记忆 `memory` | 已完成 | 三级记忆、SQLite 持久化、增量总结、表情包、8 个原生工具 |
| 工具调用 `tool_calling` | 已完成 | 注册校验调度、4 个文件工具、三档权限命令工具、工作区管理 |
| LLM 适配 `llm` | 已完成 | Anthropic、OpenAI Responses、OpenAI Chat Completions，统一协议 |
| Agent 主循环 `agent` | 未开始 | 下一步实现，串联以上三个模块 |
| CLI 对话入口 | 未开始 | Agent Loop 之后实现 |
| 沙箱 `sandbox` | 暂缓 | 强隔离延后，当前命令权限不构成安全边界 |
| MCP / Skill | 预留 | 目录与外置结构已定，适配器未实现 |

## 已实现能力细节

### 记忆

采用三级记忆，全部基于 SQLite 单库加查询视图，不做多存储同步：

- 核心记忆 `MEMORY.md`：新会话全量注入，稳定编号 `m<n>`，支持单条纠正与删除，3 万 Token 硬上限，敏感信息拦截。
- 短期记忆：近 72 小时已总结会话的 `title + desc` 索引，新会话第一轮自动注入。
- 长期记忆：更早历史不自动注入，由 Agent 按需检索，支持关键词全文检索（中文子串可用）和 7 天时间分页。
- 会话管理：每条消息即时落库，闲置 1 小时增量总结，1 天会话生命周期，启动补偿与恢复。
- 表情包：长期保存文件与情绪、适用场景元数据；普通图片只提炼文字不落盘。
- 防注入：核心记忆写入只依据用户消息，工具结果和历史内容触发 `untrustedSeen` 后禁止写入。

### 工具调用

- 统一 `ToolDefinition` 协议，`effect: read / write / send` 决定并行与串行屏障。
- 文件工具：`list_directory`、`read_file`（字节分页或 inclusive 行范围）、`search_text`、`edit_file`（精确替换、原子写入、乐观冲突检测）。
- 命令工具三档权限：`workspace`（默认，不注册 shell）、`approval`（任意命令需审批）、`open`（直接执行）。
- 工作区边界：canonical path、防路径穿越、防符号链接逃逸；`WorkspaceManager` 支持默认目录与用户选择目录。
- 跨平台：文件与搜索均为纯 Node.js 实现，不依赖 `grep`/`rg`，Windows 与 Linux 行为一致。

### LLM 适配

三家接口共用同一套 `LlmClient`，屏蔽 `tool_use`、`tool_result` 等协议差异：

| 适配器 | API | 模式选择 |
| --- | --- | --- |
| Anthropic | Messages API | 独立客户端 |
| OpenAI | Responses API | `OPENAI_API_MODE=responses`（默认） |
| OpenAI | Chat Completions API | `OPENAI_API_MODE=chat_completions` |

均支持普通调用、流式文本、函数工具、历史消息和受控错误，错误信息不包含密钥与原始响应正文。

## 已验证能力

真实 API（非 mock）已验证：

- Anthropic 调用 `read_file` 读取 `README.md` 生成项目总结，读取 `.gitignore` 给出配置建议。
- OpenAI Responses 通过 `function_call` / `function_call_output` 完成同样的文件读取与总结。
- 三种客户端分别调用 `list_directory` 查看工作区根目录，均正确返回 13 个条目并生成中文总结，完整走通"模型发起调用 → 工具执行 → 结果回传 → 模型总结"链路。

## 下一步

1. **Agent Loop**：单次请求的"输入 → 加载记忆 → LLM → 工具 → 回传 → 最终回答"循环，含最大 8 轮工具限制、超时取消、事件回调和消息落库。
2. **CLI 对话入口**：最小可交互命令行，验证连续对话与记忆效果。
3. 之后再考虑 MCP / Skill 适配和 OS 沙箱。

## 环境变量

当前统一使用以下变量，无兼容别名：

```text
ANTHROPIC_BASE_URL=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
ANTHROPIC_MAX_TOKENS=4096

OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_MAX_TOKENS=4096
OPENAI_API_MODE=responses        # 或 chat_completions
```

## 相关文档

- 记忆设计：[src/memory/DESIGN.md](../src/memory/DESIGN.md)
- 工具调用设计：[src/tools/tool_calling/DESIGN.md](../src/tools/tool_calling/DESIGN.md)
- 工作区管理：[src/tools/tool_calling/workspace_manager.md](../src/tools/tool_calling/workspace_manager.md)
- OpenAI 适配器：[src/llm/openai/README.md](../src/llm/openai/README.md)
- Anthropic 适配器：[src/llm/anthropic/README.md](../src/llm/anthropic/README.md)
