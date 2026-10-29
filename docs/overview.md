# 项目概览

> 最后更新：2026-10-29

## 定位

humanize-agent 是一个专注长期记忆的 Agent。核心目标不是堆砌工具数量，而是让 Agent 在持续交互中记住有价值的信息，并在之后的对话里自然地用上。

记忆、工具调用、LLM 适配和 Agent 主循环已完成，并已提供最小交互 CLI。可以通过 `npm run cli` 进行连续对话，验证工作区工具与长期记忆。

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
├── agent/                  # Agent 主循环，已完成
│   └── index.ts            #   记忆、LLM、工具编排与上下文控制
├── cli/                    # 最小交互 CLI，已完成
│   ├── index.ts            #   生产依赖组装与启动入口
│   ├── repl.ts             #   readline 连续对话、斜杠命令与审批
│   ├── session.ts          #   默认目录、工作区与权限切换
│   └── summarize.ts        #   LLM 增量总结器
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
| 工具调用 `tool_calling` | 已完成 | 注册校验调度、10 个文件工具、三档权限命令工具、工作区管理 |
| LLM 适配 `llm` | 已完成 | Anthropic、OpenAI Responses、OpenAI Chat Completions，统一协议 |
| Agent 主循环 `agent` | 已完成 | 串联记忆、LLM 与工具，支持 8 轮工具、取消、恢复和上下文预算 |
| CLI 对话入口 `cli` | 已完成 | 连续对话、流式输出、`/cd` 工作区切换、两档权限与命令审批 |
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
- 文件读取与查询：`get_workspace_directory`（`pwd`）、`list_directory`（`ls/dir`，省略 `path` 或传 `.` 读取当前目录，并返回 `workspace_root`）、`read_file`（字节分页或 inclusive 行范围）、`search_text`、`stat_path`、`find_path`。
- 工作区写入：`edit_file`（精确替换、原子写入、乐观冲突检测）、`create_directory`（`mkdir`，父目录必须存在且不覆盖）、`move_path`（`move`，不覆盖目标且禁止移入自身）、`delete_path`（`delete`，默认删除文件或空目录，非空目录须显式 `recursive=true`）。所有源路径和目标路径都限制在当前工作区内，禁止删除根目录。
- 命令工具三档权限：`workspace`（默认，不注册 shell）、`approval`（任意命令需审批）、`open`（直接执行）。审批会标记常见删除、移动和重命名命令为高风险并明确警告，但不自动允许或阻止命令。
- Windows 超时终止进程树时，对 `taskkill` 未能终止的失败 PID 逐个兜底；仍失败则保留命令输出并返回 `termination_error`。
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

### Agent 与 CLI

- Agent 单次请求串联记忆加载、LLM、工具执行、结果回传与消息落库，支持最大 8 批工具、取消超时、串行请求和中断恢复。
- 人工审批期间暂停 Agent 总超时，嵌套审批按深度配对；恢复后沿用剩余预算，不重置完整超时，外部取消仍然有效。审批自身与工具执行超时继续生效。
- 默认上下文预算为 10 万字符，优先压缩旧工具结果并保持调用配对；原始 SQLite 消息不修改。
- `npm run cli` 构建并启动交互 CLI。默认工作区：Windows 为 `~/Documents/humanize-agent-work`，Linux/macOS 为 `~/humanize-agent-work`，启动时自动创建。
- `/cd <路径>` 切换已存在目录，相对路径基于当前工作区；切换会重建工具，失败时保留原工作区。
- `/permission [workspace|approval]` 无参在两档间切换、带参精确设置；`workspace` 不注册 shell 或 git，但无需审批即可使用受工作区边界约束的读取、编辑、建目录、移动和删除工具；`approval` 在终端逐条审批命令，`open` 暂未开放。
- CLI 支持流式输出、`/help`、`/exit`、运行中 Ctrl+C 取消及 EOF 退出，同一进程复用记忆与会话。
- CLI 系统提示将当前工作区绝对路径、权限模式和 `run_command` 可用性作为优先于历史消息的运行状态注入：`workspace` 明确 shell 未注册，`approval` 明确命令需审批；`/cd` 或权限切换重建会话时使用最新状态，并明确相对路径基准、当前目录读取方式、专用工具优先、只读禁写删和工作区边界。

## 已验证能力

真实 API（非 mock）已验证：

- Anthropic 调用 `read_file` 读取 `README.md` 生成项目总结，读取 `.gitignore` 给出配置建议。
- OpenAI Responses 通过 `function_call` / `function_call_output` 完成同样的文件读取与总结。
- 三种客户端分别调用 `list_directory` 查看工作区根目录，均正确返回 13 个条目并生成中文总结，完整走通"模型发起调用 → 工具执行 → 结果回传 → 模型总结"链路。
- 真实 CLI 查询 `CloudLedger` 时仅调用一次 `stat_path`，未执行多余 shell。
- 真实 CLI 对 `rm -rf` 审批显示高风险警告，输入拒绝后返回 `forbidden`，命令未执行。
- 真实 CLI 在人工审批延迟后批准 `node --version`，命令继续执行并成功返回版本与零退出码。
- 真实 CLI 通过 `/cd` 切换到项目目录后，能准确回答当前绝对路径，并在省略 `path` 时通过 `list_directory` 返回正确的 `workspace_root` 与目录条目。
- 真实 CLI 在默认 `workspace`、切换 `approval`、恢复 `workspace` 后均能回答当前权限与 `run_command` 注册状态，状态询问未触发工具调用。
- 真实 CLI 在默认 `workspace` 下未使用 shell 或 git，依次完成 `pwd → mkdir → move → delete`，并通过两个 `stat_path` 确认测试目录均无残留。

## 下一步

1. 通过 CLI 持续验证真实对话、工作区操作和长期记忆效果。
2. 之后再考虑 MCP / Skill 适配和 OS 沙箱。

## 环境变量

当前统一使用以下变量，无兼容别名：

```text
LLM_PROVIDER=anthropic            # 或 openai

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

- 项目说明与使用指南：[README.md](../README.md)
- 项目协作与 Git 身份规则：[AGENTS.md](../AGENTS.md)
- 记忆设计：[src/memory/DESIGN.md](../src/memory/DESIGN.md)
- 工具调用设计：[src/tools/tool_calling/DESIGN.md](../src/tools/tool_calling/DESIGN.md)
- 工作区管理：[src/tools/tool_calling/workspace_manager.md](../src/tools/tool_calling/workspace_manager.md)
- OpenAI 适配器：[src/llm/openai/README.md](../src/llm/openai/README.md)
- Anthropic 适配器：[src/llm/anthropic/README.md](../src/llm/anthropic/README.md)
