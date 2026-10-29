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
- Web UI：Vue 3、Vite、原生 SSE；Markdown 使用 `marked + sanitize-html`
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
├── ui/                     # Vue 3 真实 Web UI，已完成
│   ├── src/                #   对话、权限、审批、工具轨迹与 SSE 客户端
│   └── server/             #   本机 Node API、Agent 编排与静态产物托管
├── llm/                    # LLM 适配层，已完成
│   ├── types.ts            #   统一 LlmClient / LlmRequest / LlmResponse 协议
│   ├── anthropic/          #   Anthropic Messages API 适配器
│   └── openai/             #   OpenAI Responses + Chat Completions 适配器
├── tools/
│   ├── index.ts            # 内置 Skill/MCP bundle 聚合加载与统一关闭
│   ├── types.ts            # 内置资源加载协议
│   ├── skill/              # SKILL.md 与 read_skill 加载器
│   ├── mcp/                # servers.json 与 stdio MCP 适配器
│   └── tool_calling/       # 工具调用层，已完成
│       ├── registry.ts     #   工具注册与 Ajv 参数校验
│       ├── executor.ts     #   调度、超时、读写串行屏障、结果截断
│       ├── file_tools/     #   工作区文件工具
│       ├── command_tools/  #   只读 argv 白名单与三档权限命令工具
│       ├── web_search.ts   #   Tavily 网页搜索工具
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
└── data/                   # 运行时数据与工具资源
    ├── memory/             #   MEMORY.md 与 memory.db
    ├── multimedia/         #   表情包等多媒体文件
    └── tools/
        ├── skill/builtin/  #   内置 Skill；其他子目录可用于外置 Skill
        └── mcp/builtin/    #   内置 MCP 清单与服务；其他子目录可用于外置 MCP
```

## 模块进度

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 记忆 `memory` | 已完成 | 三级记忆、SQLite 持久化、增量总结、表情包、8 个原生工具 |
| 工具调用 `tool_calling` | 已完成 | 注册校验调度、10 个文件工具、三档权限命令工具、Tavily `web_search`、工作区管理 |
| LLM 适配 `llm` | 已完成 | Anthropic、OpenAI Responses、OpenAI Chat Completions，统一协议 |
| Agent 主循环 `agent` | 已完成 | 串联记忆、LLM 与工具，支持 8 轮工具、取消、恢复和上下文预算 |
| CLI 对话入口 `cli` | 已完成 | 连续对话、流式输出、`/cd` 工作区切换、两档权限与命令审批 |
| Web UI `ui` | 已完成 | Vue 3 + 本机 Node 服务，真实 Agent SSE、工具轨迹、审批、停止、严格归档新对话、只读历史、权限与工作区切换、安全 Markdown，生产静态托管 |
| 沙箱 `sandbox` | 暂缓 | 强隔离延后，当前命令权限不构成安全边界 |
| 内置 MCP / Skill | 已完成 | `SKILL.md` 索引与 `read_skill`、本地 stdio MCP 发现调用、权限过滤和连接生命周期；远程 MCP 预留 |

## 已实现能力细节

### 记忆

采用三级记忆，全部基于 SQLite 单库加查询视图，不做多存储同步：

- 核心记忆 `MEMORY.md`：新会话全量注入，稳定编号 `m<n>`，支持单条纠正与删除，3 万 Token 硬上限，敏感信息拦截。
- 短期记忆：近 72 小时已总结会话的 `title + desc` 索引，新会话第一轮自动注入。
- 长期记忆：更早历史不自动注入，由 Agent 按需检索，支持关键词全文检索（中文子串可用）和 7 天时间分页。
- 会话管理：每条消息即时落库，闲置 1 小时增量总结，1 天会话生命周期，启动补偿与恢复；Web UI 显式新建通过 `startNewConversation` 严格执行“总结成功 → 关闭当前会话 → 创建隔离新会话”，总结失败时保留 active、`currentId` 和全部原始消息，不创建新会话，可修复后重试。自动轮换保留原有容错行为。归档查询覆盖全部 closed 会话（包括空标题旧数据），以 `(lastMessageAt, id)` 复合游标稳定分页。
- 表情包：长期保存文件与情绪、适用场景元数据；普通图片只提炼文字不落盘。
- 防注入：核心记忆写入只依据用户消息，工具结果和历史内容触发 `untrustedSeen` 后禁止写入。

### 工具调用

- 统一 `ToolDefinition` 协议，`effect: read / write / send` 决定并行与串行屏障。
- 文件读取与查询：`get_workspace_directory`（`pwd`）、`list_directory`（`ls/dir`，省略 `path` 或传 `.` 读取当前目录，并返回 `workspace_root`）、`read_file`（字节分页或 inclusive 行范围）、`search_text`、`stat_path`、`find_path`。
- 工作区写入：`edit_file`（精确替换、原子写入、乐观冲突检测）、`create_directory`（`mkdir`，父目录必须存在且不覆盖）、`move_path`（`move`，不覆盖目标且禁止移入自身）、`delete_path`（`delete`，默认删除文件或空目录，非空目录须显式 `recursive=true`）。所有源路径和目标路径都限制在当前工作区内，禁止删除根目录。
- 命令工具三档权限：`workspace`（默认，注册 `effect=read` 的只读白名单 `run_command`）、`approval`（继承 workspace 的只读白名单并直接放行，仅白名单外的任意 shell 命令需审批）、`open`（任意 shell 命令直接执行）。审批会标记常见删除、移动和重命名命令为高风险并明确警告，但不自动允许或阻止命令。
- `workspace` 只读命令采用 lexer + 逐命令参数 schema + 路径预检，只接受单命令 argv；非白名单命令、shell 管道/重定向/串接/代换、可写参数、包装器、分页器、未放行的网络命令和敏感路径均返回 `forbidden`，不会隐式升级为审批。路径必须留在当前工作区，递归预检默认上限 10000 项，`.env*`、私钥、凭据、`.git` 和运行时记忆禁止读取。`approval` 额外允许通过本机绝对路径只读查看工作区外的非敏感文件和目录，目标路径仍逐段拒绝符号链接/junction；非递归外部目录列表会跳过私密子项和链接而不跟随读取，`workspace` 的边界不变。
- 原生命令从可信 PATH 解析为绝对路径，通过 `shell:false` 固定 argv 执行；Windows `dir`、显示用 `cd`、`type`、`Get-Content`、`Select-String` 使用纯 Node 适配器，其中 `dir` 支持安全的 `/B`、`/S`、`/AD` 参数。Git 仅开放指定只读子命令，禁用分页器、fsmonitor、外部 diff/textconv，并隔离外部配置。该入口约束不构成 OS 沙箱。
- `curl` 在 workspace/approval 共享白名单中仅放行单一 HTTP(S) URL 的 GET/HEAD，支持常用静默、重定向、header、User-Agent、HTTP(S) proxy 和超时参数，固定禁用其他协议与 URL globbing；上传、写文件、自定义方法、本地配置和 header 文件读取仍需按模式拒绝或审批。URL 与显式 header 会发送到外部服务，该能力不构成网络隔离。
- Windows 超时终止进程树时，对 `taskkill` 未能终止的失败 PID 逐个兜底；仍失败则保留命令输出并返回 `termination_error`。
- 工作区边界：canonical path、防路径穿越、防符号链接逃逸；`WorkspaceManager` 支持默认目录与用户选择目录。
- 跨平台：文件与搜索均为纯 Node.js 实现，不依赖 `grep`/`rg`，Windows 与 Linux 行为一致。
- 网页搜索：`web_search` 使用原生 `fetch` 调用 Tavily，支持 `query`、1–20 条结果、四档 `search_depth` 和可选 answer；配置 `TAVILY_API_KEY` 后在 `workspace/approval` 均注册，未配置则不显示。默认 30 秒超时，HTTP、网络和响应错误受控且不泄露错误正文，仅返回标题、链接、摘要等精简字段，结果标记为不可信。
- 内置 Skill：`src/data/tools/skill/builtin/<name>/SKILL.md` 提供 frontmatter 与正文，系统只注入索引，`read_skill` 按需读取正文并标记不可信；加载校验 64 KiB、UTF-8、目录名称和链接边界。
- 内置 MCP：`src/data/tools/mcp/builtin/servers.json` 声明本地 stdio 服务器，支持分页发现、原名调用、30 秒默认超时和 `mcp__<server>__<tool>` 命名；单服务器失败警告降级，远程 HTTP/SSE/OAuth 暂未实现。

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
- `/permission [workspace|approval]` 无参在两档间切换、带参精确设置；实际权限发生变化时，会向切换后的下一条用户指令注入一次性「从原模式切换为当前模式」通知，后续指令不重复。该通知仅供模型内部状态同步，系统提示要求模型不复述、确认或回应通知本身，只处理实际用户指令；用户明确询问权限时才说明当前模式。`workspace` 无需审批即可使用受工作区边界约束的专用文件工具和只读白名单 `run_command`，但不开放任意 shell；`approval` 完整继承这些能力，只读白名单同样免审批，只有白名单外任意 shell 命令才在终端逐条审批，`open` 暂未开放。
- CLI 支持流式输出、`/help`、`/exit`、运行中 Ctrl+C 取消及 EOF 退出，同一进程复用记忆与会话。
- CLI 系统提示将当前工作区绝对路径、权限模式和 `run_command` 能力作为优先于历史消息的运行状态注入：`workspace` 明确 `run_command` 只允许当前工作区内的只读单命令白名单，禁止命令写入、shell 组合、代换、敏感文件及非白名单命令，同时仍提供专用文件写入工具；`approval` 明确包含 workspace 全部能力、白名单免审批及白名单外命令审批。`/cd` 或权限切换重建会话时使用最新状态，并明确相对路径基准、当前目录读取方式、专用工具优先和工作区边界。
- 内置 bundle 只在 CLI 初始化时加载一次：`workspace` 仅注册 `effect=read` 的内置工具，`approval` 注册全部；`/cd` 和权限切换复用 MCP 连接，初始化失败及 REPL 退出统一幂等关闭。构建会复制 `SKILL.md` 和 JSON 到 `dist/data/tools/`。

### Web UI

- `npm run ui` 构建后端与 Vue 并启动 `http://127.0.0.1:3210`；仅监听本机，生产服务器直接托管 `dist/ui/web/`，密钥、文件和 SQLite 不进入浏览器。开发模式使用 `npm run ui:api` 与 `npm run ui:dev`，Vite 将 `/api` 代理到 3210。
- 本地 API 提供 state、permission、chat/new、runs、runs/stop、approvals、directories、workspace、history 和 history/:id/messages；`POST /api/runs` 通过 SSE 转发真实文本增量、工具调用/结果、审批请求与用量，单会话同时只执行一个任务，断连和停止都会取消运行并清理待审批。新建归档与运行启动在服务端互斥，重复归档返回 409。
- 前端保留连续对话、实际工作区、工具轨迹、人工审批、停止、新对话、两档权限与主题切换；已移除 mock、模拟思考、产物预览、工具管理占位和完全开放模式。新对话成功完成严格归档后才重置后端上下文与本地消息，请求期间防止重复提交，失败保留当前页面。
- 左上角历史按钮打开独立两栏只读弹窗，支持全部归档和消息分页、空标题兜底；历史助手消息复用安全 Markdown，工具消息使用摘要。没有输入框、审批、恢复或历史写入操作，历史状态不进入实时 `msgs/steps/tokens`，可在 Agent 运行时查看。
- 助手消息支持 GFM Markdown，渲染后清理脚本、事件属性和危险 URL；用户消息保持纯文本，复制仍使用原始 Markdown。
- 点击顶部当前工作区会打开目录选择弹窗，可输入绝对路径、进入子目录、返回上级并确认切换；目录列表跳过私密目录与符号链接，任务运行期间前端和后端均禁止切换。

## 已验证能力

本轮全量自动化验证：26 个测试文件共 364 项通过、2 项平台相关测试跳过，TypeScript 类型检查、后端生产构建与 Vue 编译均通过。覆盖严格归档失败保留现场、空标题归档与复合游标、只读历史 API、运行/归档互斥、新建防重复及失败不清空实时状态，以及此前的外部只读、Markdown 和工作区切换。Tavily 已完成 mock 接口验证；真实 API 调用因本地尚未配置 `TAVILY_API_KEY` 而跳过。

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
- 真实 CLI 从 `dist` 加载临时内置 Skill 和 stdio MCP：`read_skill` 返回完整正文，只读 MCP 在 `workspace` 调用成功，副作用 MCP 在切换 `approval` 后调用成功；测试资源已清理。
- 目录上移后，真实 CLI 已从 `src/data/tools/skill/builtin/` 并通过 `dist/data/tools/` 成功读取验证 Skill，临时文件已清理。
- `workspace` 真实 CLI 中 `cd`、`type package.json`、`git status --short` 均无需审批成功；`node -e` 写文件、管道和 `git branch readonly-cli-probe` 返回 `forbidden`，`cat .env` 返回 `sensitive`，探测文件与分支均未创建。切换 `approval` 后，`dir /b package.json` 继承白名单能力并无需审批成功，白名单外的 `node deploy.js` 仍出现人工审批，拒绝后命令未执行。
- 真实 `curl -I -s --max-time 15 https://example.com` 在 `approval` 下通过固定安全 argv 执行成功并返回零退出码，审批回调次数为 0；固定 `-q` 禁用 curlrc 后再次验证结果相同。
- 真实 `approval` 命令工具执行 `dir /b /ad "C:\Users\Jinbin"` 返回零退出码、审批回调次数为 0；目录中的私密目录与 junction 被跳过，未跟随读取。
- 生产 Web UI 服务已直接验证：`GET /` 从 `dist/ui/web/` 返回 200 与 HTML，`GET /api/state` 返回真实默认工作区和 workspace 状态；真实 `POST /api/runs` 通过 SSE 依次返回 `run_start → message_delta(UI_OK) → run_end(done)` 及真实 token 用量，验证后服务已关闭。
- 独立生产实例已验证 `/api/directories` 能读取真实目录，`/api/workspace` 能切换到另一真实目录并恢复原工作区；验证使用临时本机端口，结束后实例已关闭。
- 使用真实 `MemoryService`、内存 SQLite 和独立生产实例完成两轮归档：两条归档均保存非空标题/摘要并出现在 `/api/history`，只读消息完整返回且当前会话 ID 不变；模拟总结失败时接口返回错误，旧会话保持 active 且不创建新会话。验证实例与临时文件已清理。

## 下一步

1. 通过 CLI 持续验证真实对话、工作区操作和长期记忆效果。
2. 之后再考虑远程 MCP、OAuth、动态刷新和 OS 沙箱。

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

TAVILY_API_KEY=                  # 可选；配置后注册 web_search
```

## 相关文档

- 项目说明与使用指南：[README.md](../README.md)
- 项目协作与 Git 身份规则：[AGENTS.md](../AGENTS.md)
- 记忆设计：[src/memory/DESIGN.md](../src/memory/DESIGN.md)
- 工具调用设计：[src/tools/tool_calling/DESIGN.md](../src/tools/tool_calling/DESIGN.md)
- 工作区管理：[src/tools/tool_calling/workspace_manager.md](../src/tools/tool_calling/workspace_manager.md)
- OpenAI 适配器：[src/llm/openai/README.md](../src/llm/openai/README.md)
- Anthropic 适配器：[src/llm/anthropic/README.md](../src/llm/anthropic/README.md)
