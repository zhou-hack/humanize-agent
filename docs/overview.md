# 项目概览

> 最后更新：2026-11-10

## 定位

humanize-agent 是一个专注长期记忆的 Agent。核心目标不是堆砌工具数量，而是让 Agent 在持续交互中记住有价值的信息，并在之后的对话里自然地用上。

记忆、工具调用、LLM 适配和 Agent 主循环已完成，并已提供交互 CLI、真实 Web UI、OneBot v11 / NapCatQQ 私聊及群聊和微信 iLink Bot 私聊入口。可分别通过 `npm run cli`、`npm run ui`、`npm run qq`、`npm run ilinkbot` 使用，也可通过 `npm run all` 构建并同时启动 Web UI、QQ 与微信服务；安装、模型配置、权限、记忆和扩展资源的完整入口说明见根目录 `README.md`。

## 技术栈

- 语言：TypeScript（ES2022、NodeNext ESM、strict 模式）
- 运行时：Node.js >= 22.13（记忆模块依赖内置 `node:sqlite`）
- 存储：SQLite（FTS5 trigram 全文索引 + Float32LE 向量 BLOB）+ `MEMORY.md` 文件
- LLM SDK：`@anthropic-ai/sdk`、`openai`（均为官方 SDK）
- 本地 Embedding：`@huggingface/transformers` + ONNX Runtime CPU
- 参数校验：Ajv
- Web UI：Vue 3、Vite、原生 SSE；Markdown 使用 `marked + sanitize-html`
- QQ 接入：OneBot v11 / NapCatQQ、`ws` 正向 WebSocket 客户端
- 微信接入：iLink Bot HTTP/JSON 协议、`qrcode` 终端与 PNG 二维码
- 测试：Vitest

## 目录结构

```text
src/
├── agent/                  # Agent 主循环，已完成
│   └── index.ts            #   记忆、LLM、工具编排与上下文控制
├── bridge/
│   └── roles.ts            # student/leader 角色、QQ 与 ilinkbot 统一身份解析
├── channel/onebot/         # OneBot v11 / NapCatQQ 私聊、群被动上下文与群 @ 入口
│   ├── client.ts           #   正向 WebSocket、echo RPC 与断线重连
│   ├── logger.ts           #   消息、思考、文件路径与网页搜索 URL 日志
│   ├── router.ts           #   私聊、群文本缓冲、仅 @ 回复、角色 scope 与队列
│   ├── segments.ts         #   array 消息段文本提取与发送构造
│   ├── types.ts            #   OneBot 私聊/群事件、@ 识别与消息类型守卫
│   └── index.ts            #   QQ 生产依赖组装、owner 配置与生命周期
├── channel/ilinkbot/       # 微信 iLink Bot 扫码登录与一对一文本私聊入口
│   ├── client.ts           #   HTTP 鉴权、getupdates、sendmessage、超时与暂停
│   ├── config.ts           #   ILINK_STATE 与 ILINK_ALLOW 解析和访问控制
│   ├── login.ts            #   登录状态机、终端二维码与 ilink_qrcode.png
│   ├── logger.ts           #   微信消息、思考、工具、文件与搜索 URL 日志
│   ├── poller.ts           #   游标长轮询、错误退避与 -14 暂停
│   ├── router.ts           #   白名单、去重、用户队列、角色会话与被动回复
│   ├── state.ts            #   token、游标、context_token 与消息 ID 原子持久化
│   ├── types.ts            #   协议 DTO、大整数 ID 与文本消息解析
│   └── index.ts            #   微信生产依赖组装、启动打印与生命周期
├── cli/                    # 最小交互 CLI，已完成
│   ├── index.ts            #   生产依赖组装与启动入口
│   ├── repl.ts             #   readline 连续对话、斜杠命令与审批
│   ├── session.ts          #   默认目录、工作区与权限切换
│   └── summarize.ts        #   LLM 增量总结器
├── ui/                     # Vue 3 真实 Web UI，已完成
│   ├── src/                #   校园品牌、主题、对话、活动策展、连接设置与 SSE 客户端
│   ├── demo/               #   独立静态交互原型（effort-slider.html 思考强度滑块）
│   └── server/             #   本机 Node API、双 scope Agent 编排、ConnectionManager 与静态托管
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
│       ├── command_tools/  #   只读 argv 白名单、三档权限命令工具与可选 LLM 命令审核
│       ├── web_search.ts   #   local Tavily / DeepSeek Search 与共享代理请求
│       ├── web_fetch.ts    #   local 直连抓取转 Markdown / DeepSeek Fetch
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
├── knowledge/              # 独立 SQLite 本地向量知识库
│   ├── embedding.ts        #   本地 E5 Embedding、固定 revision 与懒加载
│   ├── chunk.ts            #   Unicode 文本切片与重叠
│   ├── vector.ts           #   Float32LE 编解码与余弦相似度
│   ├── store.ts            #   条目、切片、向量及模型元数据持久化
│   ├── tools.ts            #   search/edit/add_knowledge 检索、临时编辑与新增工具
│   └── index.ts            #   KnowledgeService 编程 API 与生命周期
├── prompt/                 # Markdown 提示词资源与同步模板加载器
│   ├── loader.ts           #   固定名称加载、缓存、标题区块提取与变量替换
│   ├── init.md             #   全部 Agent/会话初始化提示，按二级标题分区块
│   ├── session.md          #   全部对话注入，按二级标题分区块
│   └── task/               #   会话摘要、命令审核与群消息回复判断独立任务提示
├── sandbox/                # OS 沙箱，暂缓
└── data/                   # 运行时数据与工具资源
    ├── memory/             #   MEMORY.md 与 memory.db
    ├── knowledge/          #   knowledge.db 与本地模型缓存
    ├── ilinkbot/           #   iLink 登录凭证、游标与回复上下文（Git 忽略）
    ├── multimedia/         #   表情包等多媒体文件
    └── tools/
        ├── skill/builtin/  #   内置 humanizer-zh、campus-event-curation；其他子目录可用于外置 Skill
        └── mcp/builtin/    #   内置 MCP 清单与服务；其他子目录可用于外置 MCP
```

## 模块进度

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 记忆 `memory` | 已完成 | 三级记忆、SQLite 持久化、增量总结、表情包、8 个原生工具 |
| 知识库 `knowledge` | 已完成 | 独立 SQLite、本地多语言 Embedding、文本切片、向量语义检索、student/leader 数据域，以及检索、新增与临时编辑 Agent 工具 |
| 工具调用 `tool_calling` | 已完成 | 注册校验调度、10 个文件工具、三档权限命令工具、Tavily `web_search`、工作区管理 |
| LLM 适配 `llm` | 已完成 | Anthropic、OpenAI Responses、OpenAI Chat Completions，统一协议与五档 effort 映射 |
| Agent 主循环 `agent` | 已完成 | 串联记忆、LLM 与工具，支持 8 轮工具、取消、恢复和上下文预算 |
| 提示词资源 `prompt` | 已完成 | 初始化与对话注入分别集中于 `init.md`、`session.md`，独立任务使用 `task/`，构建同步到 `dist/prompt` |
| CLI 对话入口 `cli` | 已完成 | 连续对话、流式输出、`/new` 新建会话、`/cd` 工作区切换、两档权限与命令审批 |
| OneBot `channel/onebot` | 私聊与群聊已完成 | 正向 WebSocket、Bearer token、echo RPC、自动重连、私聊隔离、同角色群会话、全文本被动缓冲、仅 @ 回复与本轮群上下文；多媒体待实现 |
| iLink `channel/ilinkbot` | 文本私聊已实现 | 终端/PNG 扫码、启动 link 打印、原子状态、长轮询、用户隔离、角色知识与被动回复；真实扫码登录已完成，私聊收发待验收，媒体与主动推送不支持 |
| Bridge `bridge` | 角色隔离已完成 | student/leader 知识域、QQ 与 ilinkbot 统一身份、同群按角色拆分会话；主动画像推荐待实现 |
| Web UI `ui` | 已完成 | 校园品牌与极光界面、主题过渡、六档推理、真实 SSE、双模式活动策展、连接设置、审批/停止/归档/历史、权限与工作区、安全 Markdown，生产静态托管 |
| 沙箱 `sandbox` | 暂缓 | 强隔离延后，当前命令权限不构成安全边界 |
| 内置 MCP / Skill | 已完成 | 内置 humanizer-zh 中文润色与 campus-event-curation 活动策划 Skill、`SKILL.md` 索引与 `read_skill`、本地 stdio MCP 发现调用、权限过滤和连接生命周期；远程 MCP 预留 |

## 已实现能力细节

### 记忆

采用三级记忆，全部基于 SQLite 单库加查询视图，不做多存储同步：

- 连接初始化先设置 `busy_timeout` 再启用 WAL，记忆库与知识库相同；`npm run all` 让 Web UI、QQ、微信并发启动时不会因抢锁报 `database is locked`，后到连接最多等待 5 秒。
- 核心记忆 `MEMORY.md`：新会话全量注入，稳定编号 `m<n>`，支持单条纠正与删除，3 万 Token 硬上限，敏感信息拦截。
- 短期记忆：近 72 小时已总结会话的 `title + desc` 索引，新会话第一轮自动注入。
- 长期记忆：更早历史不自动注入，由 Agent 按需检索，支持关键词全文检索（中文子串可用）和 7 天时间分页。
- 会话管理：每条消息即时落库，闲置 1 小时增量总结，1 天会话生命周期，启动补偿与恢复；SQLite `user_version=2` 为会话增加 `scope`，旧数据自动归入 `local`。`MemoryService` 按 scope 分别保存和恢复当前会话，CLI/Web 默认 `local`，QQ 私聊使用 `private:<QQ号>`，群聊使用 `group:<群号>:<student|leader>` 且同群同角色成员共享，不同角色不共享；微信使用 `private:ilinkbot:<from_user_id>` 按用户隔离；近期索引、日期浏览、FTS/LIKE 检索与历史消息读取均带 scope 限制，跨 scope 读取按会话不存在处理。Web UI 显式新建通过 `startNewConversation` 严格执行“总结成功 → 关闭当前会话 → 创建隔离新会话”，总结失败时保留 active、`currentId` 和全部原始消息，不创建新会话，可修复后重试。自动轮换保留原有容错行为。归档查询覆盖全部 closed 会话（包括空标题旧数据），以 `(lastMessageAt, id)` 复合游标稳定分页。
- 表情包：长期保存文件与情绪、适用场景元数据；普通图片只提炼文字不落盘。
- 防注入：核心记忆写入只依据用户消息，工具结果和历史内容触发 `untrustedSeen` 后禁止写入。核心记忆在所有入口共享读取；QQ 私聊仅 `ONEBOT_OWNER_QQ` 指定的用户可执行 `remember` / `forget_memory`，其他 QQ 私聊用户及所有 QQ 群会话返回 `forbidden`，微信 iLink 会话也全部禁止核心记忆写入，CLI/Web 默认行为不变。

### 本地向量知识库

- 独立 `src/knowledge/` 与 `src/data/knowledge/knowledge.db`，不复用会话记忆连接。`knowledge_entries` 保存原文和 metadata，`knowledge_chunks` 保存切片及 Float32LE BLOB，`knowledge_embedding` 固定保存模型、384 维与向量格式，schema 使用 `user_version=2`，`knowledge_entries.audience` 强制为 `student` 或 `leader` 并带索引；v1 旧条目自动迁移为 `student`。
- 本地 `Xenova/multilingual-e5-small` 通过 Transformers.js + ONNX Runtime CPU 推理，固定模型 revision、q8、mean pooling、归一化及 E5 query/passage 前缀。首次实际使用时下载模型；完整缓存的 `config.json`、tokenizer 和量化 ONNX 文件存在时，直接以本地 revision 目录作为模型路径并启用 `local_files_only`，避免 Transformers.js 在离线环境仍请求远端文件元数据。启动和空库检索不加载模型，缓存路径可用 `KNOWLEDGE_MODEL_CACHE_DIR` 覆盖。
- `KnowledgeService.add/edit/delete/search` 提供编程写入、编辑、级联删除与检索 API；文本按约 1200 个 Unicode code point、200 重叠切分，Embedding 在 SQLite 写事务外完成。编辑按现有 ID 获取旧条目，省略 title/metadata 时沿用旧值并保留创建时间，正文和全部新向量在一个事务内替换，失败保留旧正文和旧切片；新增与编辑均检查模型及维度兼容性。
- 检索精确扫描指定角色的向量并计算余弦相似度，支持 1–8 条 top-k 和可选 `minScore`，同分按 chunk ID 稳定排序；第一版不引入 `sqlite-vec`、ANN 或混合检索。`KnowledgeService` 编程 API 可显式传 `audience`，不传时用于管理端全量检索；新增默认 student，编辑保留原角色并在角色不匹配时按条目不存在拒绝。
- Agent 注册只读 `search_knowledge`、写工具 `add_knowledge` 与按当前需求临时开放的写工具 `edit_knowledge`，CLI/Web/QQ、workspace/approval 均可使用，冷启动工具超时为 180 秒。检索结果标记不可信；新增仅限用户明确要求添加独立新资料，ID 可省略并自动生成，重复 ID 拒绝写入；编辑仅限用户明确要求修改指定资料，传入完整替换正文并重新生成向量。两个写工具均不得根据对话推测擅自调用，不提供 Agent 删除知识工具；`edit_knowledge` 后续可移除。知识库使用、编辑与新增规则集中在 `init.md#knowledge`，共享服务在 `/cd` 和权限切换时复用，并由 CLI/Web/QQ 顶层统一关闭。
- 每次新会话注入校园问答与角色规则：校园服务、学校制度、办事流程、地点和部门联系方式问题必须先自动检索，无需用户手动要求；回答按“结论 → 办理步骤 → 材料、地点和时间 → 信息来源”组织，资料不足时明确提示“当前校园知识库暂无足够可靠的资料”，不得虚构学校政策或联系方式。`createKnowledgeTools` 由服务端固定传入当前角色，工具 schema 不接受 audience 参数，模型不能自行越权；检索、编辑和新增均只作用于当前 student/leader 数据域。CLI/Web 使用 `BRIDGE_ROLE`，QQ 使用 `BRIDGE_LEADER_IDS`；当前仅实现提问时自动相似检索，不做主动画像推荐。

### 工具调用

- 统一 `ToolDefinition` 协议，`effect: read / write / send` 决定并行与串行屏障。
- 文件读取与查询：`get_workspace_directory`（`pwd`）、`list_directory`（`ls/dir`，省略 `path` 或传 `.` 读取当前目录，并返回 `workspace_root`）、`read_file`（字节分页或 inclusive 行范围）、`search_text`、`stat_path`、`find_path`。
- 工作区写入：`edit_file`（精确替换、原子写入、乐观冲突检测）、`create_directory`（`mkdir`，父目录必须存在且不覆盖）、`move_path`（`move`，不覆盖目标且禁止移入自身）、`delete_path`（`delete`，默认删除文件或空目录，非空目录须显式 `recursive=true`）。所有源路径和目标路径都限制在当前工作区内，禁止删除根目录。
- 命令工具三档权限：`workspace`（默认，只读白名单 `run_command`，白名单外命令经模型审核不危险才执行）、`approval`（继承 workspace 的只读白名单并直接放行，白名单外命令经模型审核不危险直接执行，危险或审核失败才需审批）、`open`（任意 shell 命令直接执行）。审批会标记常见删除、移动和重命名命令以及模型判定危险的命令为高风险并明确警告。
- `workspace` 只读命令采用 lexer + 逐命令参数 schema + 路径预检，只接受单命令 argv；非白名单命令、shell 管道/重定向/串接/代换、可写参数、包装器、分页器、未放行的网络命令和敏感路径均返回 `forbidden`，不会隐式升级为审批。路径必须留在当前工作区，递归预检默认上限 10000 项，`.env*`、私钥、凭据、`.git` 和运行时记忆禁止读取。`approval` 额外允许通过本机绝对路径只读查看工作区外的非敏感文件和目录，目标路径仍逐段拒绝符号链接/junction；非递归外部目录列表会跳过私密子项和链接而不跟随读取，`workspace` 的边界不变。
- `workspace/approval` 命令自动审核：CLI/WebUI/QQ 启动时用 Agent 主模型的同一个 `LlmClient` 创建审核器，白名单外的命令先向主模型发送一次独立的审核请求（只含判定系统提示与命令原文，不带会话历史、记忆和工具，不写入对话记录，也不计入工具轮数），返回 `{command, readonly, dangerous}`。`workspace`：`dangerous=false` 即以系统 shell 在工作区执行（只读或普通写入均可），`dangerous=true` 返回 `forbidden`，审核超时（默认 30 秒）、调用失败、JSON 无效或回显命令与原文不一致均拒绝执行（fail closed）。`approval`：`dangerous=false` 同样直接执行、不再打扰用户，只有 `dangerous=true`（审批卡片标记为高风险）或审核失败时才转人工审批，审核失败不会自动放行。判定提示词注入当前工作区路径与执行 shell，读写工作区外路径、全局安装/配置视为危险；`sensitive` 路径不送审（`workspace` 直接拒绝，`approval` 直接转人工审批）。启用后 `run_command` 的 `effect` 为 `write`（串行执行），超时额外包含审核时间，结果附带 `review` 字段。该审核基于模型判断，不是 OS 沙箱。实现位于 `command_tools/command_judge.ts`。
- 原生命令从可信 PATH 解析为绝对路径，通过 `shell:false` 固定 argv 执行；Windows `dir`、显示用 `cd`、`type`、`Get-Content`、`Select-String` 使用纯 Node 适配器，其中 `dir` 支持安全的 `/B`、`/S`、`/AD` 参数。Git 仅开放指定只读子命令，禁用分页器、fsmonitor、外部 diff/textconv，并隔离外部配置。该入口约束不构成 OS 沙箱。
- `curl` 在 workspace/approval 共享白名单中仅放行单一 HTTP(S) URL 的 GET/HEAD，支持常用静默、重定向、header、User-Agent、HTTP(S) proxy 和超时参数，固定禁用其他协议与 URL globbing；上传、写文件、自定义方法、本地配置和 header 文件读取仍需按模式拒绝或审批。URL 与显式 header 会发送到外部服务，该能力不构成网络隔离。
- Windows 超时终止进程树时，对 `taskkill` 未能终止的失败 PID 逐个兜底；仍失败则保留命令输出并返回 `termination_error`。
- 工作区边界：canonical path、防路径穿越、防符号链接逃逸；`WorkspaceManager` 支持默认目录与用户选择目录。
- 跨平台：文件与搜索均为纯 Node.js 实现，不依赖 `grep`/`rg`，Windows 与 Linux 行为一致。
- 网页工具模式：`WEB_SEARCH_MODE=local|deepseek`，默认 local。local 的 `web_search` 保留 Tavily `query`、1–20 条结果、四档深度和可选 answer，配置 `TAVILY_API_KEY` 后注册；`web_fetch` 不依赖搜索 Key，直接读取 HTTP(S) HTML/文本并用 Turndown 转 Markdown，单页限制 2 MiB、正文限制 10 万字符。deepseek 的 `web_search`、`web_fetch` 分别调用官方 `POST /v1/tools/search`、`POST /v1/tools/fetch`，共用 `DEEPSEEK_API_KEY` 与默认 `https://api.deepseek.com` 的 `DEEPSEEK_BASE_URL`；缺少 Key 时两个工具均隐藏，不回退 local。Search 支持 1–128 个 Unicode 字符、1–50 条结果、`need_content` 和 `ori_question`，Fetch 返回官方 Markdown。两档权限及 CLI/Web/QQ 均通过共享会话注册，结果始终标记不可信。
- 网页请求与代理：Tavily、DeepSeek 和 local 抓取均默认 30 秒超时，HTTP、网络和响应错误受控且不泄露错误正文。代理请求使用 `undici` 自带的 fetch 与 `ProxyAgent`，直连保留 Node 全局 fetch，避免 `UND_ERR_INVALID_ARG`；`WEB_SEARCH_PROXY_URL` 提供默认 HTTP(S) 代理，AI 可用单次 `proxy_url` 覆盖，未配置则直连。仅接受不带路径、查询或片段的 HTTP(S) 代理，SOCKS 和非法地址在请求前拒绝；代理在响应处理后关闭，工具结果不返回代理地址或服务端错误正文。`web_fetch` 仅接受不携带用户名或密码的 HTTP(S) URL，local 抓取限制内容类型与 2 MiB 流式读取上限。带凭据代理建议放在 `.env`，避免进入工具参数和界面轨迹。
- 内置 Skill：`src/data/tools/skill/builtin/<name>/SKILL.md` 提供 frontmatter 与正文，系统只注入索引，`read_skill` 按需读取正文并标记不可信；加载校验 64 KiB、UTF-8、目录名称和链接边界。当前内置 `humanizer-zh`，来源为 `op7418/humanizer-zh` 的 `f4518a8` 版本，用于中文文本去空话、重复与模板化表达，保留事实、确定程度和作者声音，不用于作者身份判断或保证通过 AI 检测；副本仅精简 frontmatter，正文已与上游核对一致，MIT 许可证随源码和构建产物保留。
- 内置 MCP：`src/data/tools/mcp/builtin/servers.json` 声明本地 stdio 服务器，支持分页发现、原名调用、30 秒默认超时和 `mcp__<server>__<tool>` 命名；单服务器失败警告降级，远程 HTTP/SSE/OAuth 暂未实现。

### LLM 适配

三家接口共用同一套 `LlmClient`，屏蔽 `tool_use`、`tool_result` 等协议差异：

| 适配器 | API | 模式选择 |
| --- | --- | --- |
| Anthropic | Messages API | 独立客户端 |
| OpenAI | Responses API | `OPENAI_API_MODE=responses`（默认） |
| OpenAI | Chat Completions API | `OPENAI_API_MODE=chat_completions` |

均支持普通调用、流式文本、函数工具、历史消息和受控错误，错误信息不包含密钥与原始响应正文。可选 `effort` 支持 `low/medium/high/xhigh/max`，分别映射为 Anthropic `output_config.effort`、Responses `reasoning.effort`、Chat Completions `reasoning_effort`；未提供时不添加字段，保持各服务端默认行为。

思考内容统一映射为 `thinking` 块，`stream()` 的第三个参数 `onThinking` 接收思考增量：Anthropic 转发 `thinking` 事件并保留签名，历史中只回传带签名的思考块；Responses 转发 `reasoning_text` / `reasoning_summary_text` 增量，回传时丢弃思考块；Chat Completions 暂不解析思考内容。实测 MiniMax `MiniMax-M3.1-Flash` 走 Anthropic 协议时默认返回思考块（无需 `thinking` 参数），思考内容按约百字的分片逐步到达；一道简单推理题实测第 1.5 秒出现首段思考、4.2 秒出现正文，Responses 与 Chat Completions（`reasoning_content`）同样逐步推送。

### Agent 与 CLI

- Agent 单次请求串联记忆加载、LLM、工具执行、结果回传与消息落库，支持最大 8 批工具、取消超时、串行请求和中断恢复。恢复 SQLite 历史时只为遗留的悬空 `tool_use` 补齐中断结果，并且仅接受当前 assistant 待处理、尚未输出的工具结果；并发运行造成的跨轮迟到结果和同轮重复结果会被忽略，避免 OpenAI Responses 因重复 `function_call_output` 拒绝后续整段会话。流式事件包含 `text_delta`、`thinking_delta`、`tool_call`、`tool_result`；思考块随助手消息落库，但不进入全文索引和历史摘要文本，CLI 不显示思考内容。单次 `AgentRunOptions.effort` 会贯穿该运行的全部工具轮与最终请求，不写入历史消息，排队或后续运行不继承。
- 每条新用户消息在发往 LLM 前注入 `[运行环境当前时间：本地 ISO 时间（时区）]`，格式包含年月日、时分秒、UTC 偏移和 IANA 时区名称；每次用户输入重新取值，后续工具轮保留该次时间上下文。SQLite、会话恢复、摘要和长期记忆仍保存用户原文，不写入时间前缀。
- 人工审批期间暂停 Agent 总超时，嵌套审批按深度配对；恢复后沿用剩余预算，不重置完整超时，外部取消仍然有效。审批自身与工具执行超时继续生效。
- 默认上下文预算为 10 万字符，优先压缩旧工具结果并保持调用配对；原始 SQLite 消息不修改。
- `npm run cli` 构建并启动交互 CLI。默认工作区：Windows 为 `~/Documents/humanize-agent-work`，Linux/macOS 为 `~/humanize-agent-work`，启动时自动创建。
- `/cd <路径>` 切换已存在目录，相对路径基于当前工作区；切换会重建工具，失败时保留原工作区。
- `/new` 在 CLI、QQ 私聊与群 @、微信私聊和 Web UI 输入框中通用：调用 `MemoryService.startNewConversation`，先总结并归档当前会话，再创建隔离的新会话；命令本身不进入模型和对话记录。总结失败时保留原会话并返回错误，不创建新会话。
- `/permission [workspace|approval]` 无参在两档间切换、带参精确设置；实际权限发生变化时，会向切换后的下一条用户指令注入一次性「从原模式切换为当前模式」通知，后续指令不重复。该通知仅供模型内部状态同步，系统提示要求模型不复述、确认或回应通知本身，只处理实际用户指令；用户明确询问权限时才说明当前模式。`workspace` 无需审批即可使用受工作区边界约束的专用文件工具和只读白名单 `run_command`，但不开放任意 shell；`approval` 完整继承这些能力，只读白名单同样免审批，白名单外命令经模型审核不危险直接执行，只有判定危险或审核失败的命令才在终端逐条审批，`open` 暂未开放。
- CLI 支持流式输出、`/help`、`/exit`、运行中 Ctrl+C 取消及 EOF 退出，同一进程复用记忆与会话。
- CLI 系统提示将当前工作区绝对路径、权限模式和 `run_command` 能力作为优先于历史消息的运行状态注入：`workspace` 明确 `run_command` 只允许当前工作区内的只读单命令白名单，禁止命令写入、shell 组合、代换、敏感文件及非白名单命令，同时仍提供专用文件写入工具；`approval` 明确包含 workspace 全部能力、白名单免审批及白名单外命令审批。`/cd` 或权限切换重建会话时使用最新状态，并明确相对路径基准、当前目录读取方式、专用工具优先和工作区边界。
- CLI/WebUI 系统提示额外注入「工具调用规则」以减少冗余调用：告知每任务最多 8 轮工具，结果够用即作答、不为补充细节重复查询，先确认关键参数（如地点）再查询而非估值试探，互不依赖的调用同轮并发，专用工具优先、`run_command` 兜底，失败后理解原因再调整、同类方法失败两次即换思路。
- 内置 bundle 只在 CLI 初始化时加载一次：`workspace` 仅注册 `effect=read` 的内置工具，`approval` 注册全部；`/cd` 和权限切换复用 MCP 连接，初始化失败及 REPL 退出统一幂等关闭。构建会复制 `SKILL.md`、Skill `LICENSE` 和 JSON 到 `dist/data/tools/`。

### OneBot / NapCatQQ 私聊、群被动上下文与群 @

- `npm run qq` 构建并启动 `src/channel/onebot/index.ts`，读取 `ONEBOT_WS_URL`（默认 `ws://127.0.0.1:3001`）、可选 `ONEBOT_ACCESS_TOKEN`、`ONEBOT_OWNER_QQ` 与 `BRIDGE_LEADER_IDS`。客户端使用 `ws` 连接 NapCat 正向 WebSocket，token 通过 `Authorization: Bearer` 头发送，不写入 URL 或日志。原 `NOAT_QQ_GROUP` 与免 @ AI 回复判断已移除，所有群统一只有明确 @ 机器人才回复。
- 所有 OneBot action 使用随机 `echo` 关联 RPC 响应，支持超时、失败 retcode 和断线时拒绝未完成请求；连接断开后按 1 秒至 15 秒指数退避自动重连，关闭时停止重连并释放请求。
- 入站只接受符合 OneBot v11 结构的 array 消息段，私聊拼接 text 段。所有群文本都会进入被动缓冲，包括未 @、@ 其他成员和 @ 全体；只有 at 段的 `data.qq` 与事件 `self_id` 匹配时才进入 Agent 并回复，其他消息不调用模型、不创建群会话。机器人自身消息、空文本和纯非文本消息仍忽略，不处理 QQ 图片或文件。私聊回复使用 `send_private_msg`，群回复使用 `send_group_msg` 并在 array 消息中先 @ 发言成员再发送换行与正文。
- `OneBotRouter` 按 `group:<群号>:<student|leader>` 在内存中保存最近 50 条、最多约 2 万字符的被动消息，重启清空，不同群和角色互不混入。@ 时将此前消息以 JSON 注入 `AgentRunOptions.context`，当前 @ 文本仍是唯一新指令；Agent 在所有工具轮保留该背景，但 SQLite 只保存用户原文，运行结束后内存消息也恢复为不含背景的原文，下一轮不会自动延续。私聊 scope 为 `private:<QQ号>`，群会话仍按角色懒创建并共享同角色队列；CLI、QQ、微信均可检索知识库但对话 scope 不共享。Agent 失败只返回通用错误，入口统一释放共享资源。私聊或群 @ 发送 `/new` 时直接归档当前 scope 会话并回复「已开始新对话。」，不调用模型。
- `OneBotLogger` 直接接入路由和 Agent 事件流，输出 `[recvMessage]`、`[sendMessage]`、`[think]`、统一 `[tool]`、`[files] read/write` 与 `[tools] web_search: <url>`。收发日志包含 QQ 号和文本，群消息额外记录 `group:<群号> user:<发言人QQ>`；思考在首个真实增量到达时立即输出 `[think]: `，同一轮在同一行流式追加，正文、工具事件、其他消息或发送日志到达时自动换行，不再逐 token 换行；统一 `[tool]` 覆盖所有工具调用，仅输出工具名及 id/query/path/source/destination/url/command/title/分页等关键参数，知识正文和文件编辑正文不写入日志；文件日志仅含工具名及 path/source/destination，网页搜索调用记录查询词、成功结果逐条提取 URL，发送日志仅在 OneBot RPC 成功后记录。同一用户连续来消息不会提前清理上一轮搜索调用关联。
- QQ 私聊使用 `private:<QQ号>` memory scope，群聊使用 `group:<群号>:<student|leader>`，与 CLI/Web 的 `local`、其他 QQ 用户、其他群及同群另一角色隔离当前会话、近期上下文和长期记忆检索；同群同角色成员共享群会话。旧 `group:<群号>` 会话不会自动迁移到新角色 scope。全局核心记忆仍共享读取，私聊只有 owner 可写，群会话即使由 owner 发言也禁止写入；群回复对所有成员公开可见，角色隔离不构成群聊保密边界。
- QQ 不做只读降级：与 CLI 一样默认使用 `workspace` 和同一默认工作区，保留 `search_knowledge`、`edit_knowledge`、`add_knowledge`、`read_file`、`edit_file`、建目录、移动、删除、网页搜索和只读内置工具。白名单外命令仍使用模型审核，但 QQ 无人工审批界面，需要人工审批时回调固定拒绝；QQ 不提供 `/cd` 或权限切换命令。启用前应确认信任私聊使用者及群成员操作该工作区。

### 微信 iLink Bot 私聊

- `npm run ilinkbot` 构建并启动 `src/channel/ilinkbot/index.ts`，复用 CLI 的 MemoryService、KnowledgeService、LLM、总结器、命令审核器与内置工具。`ILINK_STATE` 默认 `src/data/ilinkbot/state.json`，`ILINK_ALLOW` 是逗号分隔的用户 ID；白名单为空仅允许扫码人，非空严格按名单允许，未授权消息静默忽略。状态目录与根目录 `ilink_qrcode.png` 均已 Git 忽略。
- 无登录状态时通过 `get_bot_qrcode` 获取二维码，`qrcode_img_content` 由 `qrcode` 包同时渲染到终端并保存为 `ilink_qrcode.png`，`qrcode` 仅作为轮询 key。登录覆盖 wait、scaned、数字验证码、过期刷新、HTTPS 重定向、已绑定和 confirmed；成功后保存 token/baseurl/bot_id/owner_id。已有状态和新登录启动都打印 `[link] owner_id=<扫码人> bot_id=<Bot ID>`，协议无昵称字段，日志不输出 token、二维码 key 或 context_token。
- HTTP 客户端遵循 SDK 2.4.10 请求头、每次随机 `X-WECHAT-UIN`、base_info 与登录后 baseurl。`getupdates` 初始长轮询 35 秒并按服务端值调整，普通超时直接续轮，其他失败按 2 秒/连续三次 30 秒退避，`ret/errcode=-14` 暂停一小时且不删除 token。游标、最多 2000 个消息 ID 和每用户最新 context_token 原子持久化，数值型 uint64 ID 在 JSON 解析前转字符串。
- `ILinkRouter` 仅接受授权用户的文本消息，按 message_id 去重；每用户懒建 `CliSession`，scope 为 `private:ilinkbot:<from_user_id>`，同用户顺序、不同用户并行。角色由 `resolveBridgeAudience('ilinkbot', from_user_id, BRIDGE_LEADER_IDS)` 固定，默认学生；所有微信会话 `allowCoreWrite=false`，无终端人工审批。builtin 在各会话中不重复关闭，由顶层统一释放。`/new` 直接归档当前会话并回复「已开始新对话。」。
- `sendmessage` 使用外层 msg、唯一 client_id、message_type/state=2、单文本 item 和最新 context_token，按 4000 个 Unicode 字符分段；无 token 不发送，只支持被动文本私聊，不支持群聊、媒体或主动推送。关闭时中止登录/轮询，drain 会话后依次释放 HTTP、builtin、Knowledge 和 Memory。

### 提示词资源

- 固定系统提示与注入包装统一放在 `src/prompt/**/*.md`，动态工作区路径、权限模式、Skill 索引、记忆正文、用户消息和待审命令仍由代码生成，不将运行时数据写回模板。
- `init.md` 集中保存 Agent/会话初始化内容：默认系统提示、四种权限上下文、工作区状态、工具调用规则、知识库检索规则、Skill 索引及核心/最近记忆包装；`session.md` 集中保存每条用户输入的时间前缀、一次性权限通知和最终工具轮限制。两个文件均通过 `## 模板名` 二级标题划分区块；`task/` 保存会话摘要与命令安全审核的独立任务提示。
- `renderPrompt` 按固定名称同步读取并缓存源文件和模板，合并文件只提取目标标题下的内容，仅支持 `{{variable}}` 单次替换，缺少变量立即报错，不引入条件、循环或异步模板引擎。CLI/WebUI、Agent、Skill、最近记忆、摘要和命令审核均通过同一入口加载，原有 system 拼接顺序、消息角色、权限通知入库及时间前缀不入库语义保持不变。
- 后端构建除内置 Skill/MCP 资源外，还将 4 份 Markdown（共 17 个命名模板）复制到 `dist/prompt/`，复制前清理旧 `init/`、`session/` 与 `task/` 资源目录以避免已删除 Markdown 残留，同时保留编译后的加载器；加载器基于 `import.meta.url` 定位资源，生产运行不依赖 `src` 或当前工作目录。
- README 的提示词章节以 **Everything can be configured** 强调可直接调整初始化与对话注入，并嵌入 `docs/screenshots/memory.init.png`、`docs/screenshots/memory.session.png` 两张实际配置截图。

### Web UI

- `npm run ui` 构建后端与 Vue 并启动 `http://127.0.0.1:3210`；仅监听本机，生产服务器直接托管 `dist/ui/web/`，密钥、文件和 SQLite 不进入浏览器。开发模式使用 `npm run ui:api` 与 `npm run ui:dev`，Vite 将 `/api` 代理到 3210。
- 本地 API 提供 state、permission、chat/new、runs、runs/stop、approvals、directories、workspace、history、history/:id/messages 及 connection。普通聊天与活动策展通过 `mode=chat|curation` 路由到两个 CliSession，缺省 chat 保持旧客户端兼容；memory scope 分别为 `local`、`ui:event-curation`，各自维护 active run、启动、审批、停止、严格归档和只读历史，跨 scope 消息按不存在返回 404。SSE 保留真实文本、思考、工具、审批和用量，任一模式运行、启动或归档时禁止工作区、权限和连接切换。
- 前端整合 agentnew 的校园小管家品牌、开场动画、首页主标语“校园大小事，问我就对了.”、极光玻璃、中文工具名、消息与执行轨迹、响应式和深浅色 Composer；保留真实 Agent、思考流、工具轨迹、人工审批、停止和安全 Markdown，不使用 mock 或伪造 Agent 输出。普通聊天与策展分别持有消息、步骤、Token、草稿、运行和审批状态，直接切页不归档；新对话只归档当前模式，失败保留现场。鼠标指针使用系统默认样式，不启用自定义光标或指针捕获；主题按钮使用圆形扩散和图标旋转，连续点击可衔接并遵守 reduced-motion。
- 历史按钮打开独立两栏只读弹窗，支持当前模式归档与消息分页、空标题兜底；历史助手消息复用安全 Markdown，工具消息使用摘要。没有输入框、审批、恢复或历史写入操作，历史状态不进入对应模式的实时 `msgs/steps/tokens`，可在 Agent 运行时查看。
- 助手消息支持 GFM Markdown，渲染后清理脚本、事件属性和危险 URL；用户消息保持纯文本，复制仍使用原始 Markdown。
- 活动策展使用 `init/event-curation` 系统提示按需读取 `campus-event-curation` Skill，隐藏指令不进入用户消息。主题、预算、策划书、申请表、推文和海报模板已内联进单一 `SKILL.md`；四问卡作为六问浓缩预问答并保留默认值与快速通道。
- `ConnectionManager` 实现统一 LlmClient，支持 OpenAI/Anthropic 公开配置查询、10 秒最多 200 条模型列举、同 provider 密钥复用、换 provider 强制重填、原子保存与热切换；Agent、总结器和命令审核共享同一实例。配置存于 `~/.humanize-agent/connection.json` 并优先 `.env`，API Key 不回显、不写 localStorage，但文件是 0600 明文，Windows 上不等于加密。保存不等于连通性验证，且只影响 Web UI，QQ/微信仍使用启动时 `.env`。
- 点击顶部当前工作区会打开目录选择弹窗，可输入绝对路径、进入子目录、返回上级并确认切换；目录列表跳过私密目录与符号链接。工作区和权限同步应用到 chat/curation 两个会话，任一模式任务运行、启动或归档期间前后端均禁止切换。
- 输入区保留真实多行 composer：Enter 发送、Shift+Enter 换行、IME 合成不误发，深浅色独立背景、边框、阴影和金色 focus。输入 `/new` 与侧栏「新对话」等价，直接归档并开始新会话，输入框中的命令不会作为消息发出。`EffortSlider` 提供六档用途说明、当前模型、恢复默认、拖动吸附、直接点选与键盘操作；默认高档并保存偏好，Ultra 仅改变视觉并发送 `max`，运行或归档时禁止调整。`src/ui/demo/effort-slider.html` 仍是独立原型，不参与构建。

## 已验证能力

本轮全量自动化验证（`--maxWorkers=4`）：46 个测试文件通过、1 个文件跳过，共 560 项通过、3 项跳过，TypeScript 类型检查与后端生产构建通过。新增 `/new` 覆盖 CLI、QQ、微信路由与 `CliSession` 归档隔离测试：命令不调用 Agent，归档旧会话并创建不含历史的新会话。Agent 新增跨轮迟到及同轮重复工具结果恢复回归；使用真实 OpenAI 和原微信受损会话验证，修复前稳定复现 `400 Duplicate tool output for call_id`，修复后同一生产会话成功完成知识检索和正文生成，QQ 生产会话对照链路同样通过。新增知识库测试覆盖文本切片、向量编解码、事务回滚、持久化、模型兼容、检索排序、工具不可信标记、student/leader schema 迁移、服务端角色固定、跨角色编辑拒绝、同群角色会话隔离、两档权限与工作区切换装配；真实本地模型冒烟默认跳过，fake Embedding 测试不下载模型或访问网络。iLink 新增 41 项自动化测试，覆盖协议解析、状态持久化、请求头、Unicode 分段、扫码状态机与真实 PNG、白名单/角色/队列、轮询退避和日志脱敏。Web UI 新增覆盖双 scope 运行/审批/归档/历史、策展原始输入、连接脱敏/密钥复用/持久化/热切换/锁定和 Skill 内联资料。提示词测试现覆盖 4 份 Markdown 中的 17 个命名模板。Tavily 真实 API 已通过本机 `127.0.0.1:7897` HTTP 代理调用成功；Node 直连后续实测出现 `ECONNRESET`，当前以已验证的代理链路为准。

内置 `humanizer-zh` 已通过真实资源加载测试，`read_skill` 能返回完整 A–F 编辑规则并标记不可信；内置正文与上游 `f4518a8` 版本逐字核对一致。生产构建后已从 `dist/data/tools/` 成功加载索引和完整正文，并确认同目录保留 MIT `LICENSE`，冒烟结果为 `PRODUCTION_HUMANIZER_ZH_OK`。

`web_search` 代理测试覆盖无代理继续使用 Node 全局 fetch、代理切换 undici fetch、默认代理、AI `proxy_url` 覆盖、非法协议和路径拒绝、错误及代理地址脱敏，以及成功和失败后的代理连接释放。修复前对比实测确认：当前 LLM 最小请求成功、web_search 直连曾成功、curl 代理可连接 Tavily、undici fetch 代理可访问 example.com，只有 Node 全局 fetch + 外部 ProxyAgent 以 `UND_ERR_INVALID_ARG` 失败；据此将代理路径单独切换为同一 undici 实现的 fetch。修复后真实 `127.0.0.1:7897` 代理搜索 Tavily 成功，结果为 `WEB_SEARCH_PROXY_VERIFIED_OK`；完整生产 Agent 使用当前真实 OpenAI 模型发起 `web_search`，经代理获得 1 条结果并完成中文总结，结果为 `AGENT_WEB_SEARCH_PROXY_OK calls=web_search rounds=1`。Node 全局与 undici 直连随后均出现 `ECONNRESET`，而 curl 直连可到达 Tavily，因此直连稳定性仍受当前网络环境影响，已配置的代理链路验证通过。

双模式网页工具已完成真实验证：local `web_fetch` 经 `127.0.0.1:7897` 代理抓取 `https://example.com`，成功转换为包含 `Example Domain` 的 Markdown，结果为 `LOCAL_WEB_FETCH_OK chars=172`。DeepSeek Search 使用官方 `/v1/tools/search` 返回有效结果，DeepSeek Fetch 使用 `/v1/tools/fetch` 返回标题 `Example Domain` 和 916 字符的多语言 Markdown 正文；首次正文断言因官方内容并非固定英文文本而不匹配，随后检查实际标题、正文长度和内容确认协议正常，并非字段适配错误。真实验证仅在进程内提供 DeepSeek 凭据，未切换 `.env` 中默认的 local 模式。

OneBot 本轮验证：

- 自动化覆盖 v1 → v2 旧库 scope 迁移、不同 QQ 用户及 local 的会话恢复与检索隔离、非 owner 核心记忆写保护，以及 QQ 默认 workspace 下的知识检索和文件编辑工具注册。
- 使用本机真实 WebSocket 服务验证 Bearer token、echo RPC 成功/失败、array 私聊收发、同用户顺序处理、断线拒绝未完成请求、自动重连和关闭后停止重连。
- 日志自动化覆盖私聊收发与 Agent 事件转发、思考增量、所有工具的统一 `[tool]` 调用记录、文件读写路径、web_search 结果 URL、知识/文件编辑正文不落入日志，以及同一用户下一条消息到达后上一轮搜索 URL 仍能正确关联输出。
- 生产构建后的 `dist/channel/onebot` 客户端与路由完成真实 WebSocket 冒烟，收到模拟私聊后经 Agent 会话接口回复 `PRODUCTION_QQ_OK` 并成功完成 `send_private_msg` RPC。
- 群聊自动化覆盖所有普通文本、@ 其他成员和 @ 全体仅进入缓冲且不回复，明确 @ 才创建会话并回复；@ 请求携带此前同群消息，不包含当前消息、自身消息或其他群内容。同群两名学生只创建一个 `group:<群号>:student` 会话并顺序共享，领导使用独立的 `group:<群号>:leader` 会话；学生/领导被动上下文也分别隔离。Agent 测试确认背景仅在本轮模型请求可见，SQLite 用户原文不含背景，下一轮不再携带。生产 `dist` 冒烟结果为 `PRODUCTION_GROUP_CONTEXT_OK replies=1 passive=true`，`npm run all` 已重新拉起 Web UI、QQ 和微信，Web UI `/api/state` 返回 200。未向真实 QQ 群发送测试消息，真实群验收仍待进行。
- 本机 NapCatQQ 已通过 WebUI API 热更新启用 `127.0.0.1:3001` 正向 WebSocket（array、空 token），无需重启 QQ；已确认 3001 由 NapCat 进程监听，真实 WS 连接和 `get_login_info` RPC 均成功。真实私聊已接收“你好”并回复“你好！有什么需要帮忙的吗？”，终端同时显示流式思考与收发日志；真实 QQ 群 @ 与被动上下文收发尚未验收。

iLink Bot 生产入口已真实请求 `https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3` 成功，终端二维码与根目录 `ilink_qrcode.png` 均已生成并检查。用户已完成真实微信扫码，登录状态已落盘；`npm run all` 启动时成功打印扫码人的 `[link] owner_id/bot_id` 并进入 `getupdates` 长轮询，真实私聊收发仍待验收。

本地知识库真实验证（非 mock）：

- 显式运行 `KNOWLEDGE_EMBEDDING_SMOKE=1` 冒烟，真实 `Xenova/multilingual-e5-small` 首次下载并完成本地 ONNX 推理，返回 384 维有限且归一化向量，中文相关文本相似度高于无关文本。
- 使用 `local_files_only=true` 直接从既有缓存加载同一 revision 和 q8 模型，成功生成 `1x384` 向量，确认缓存可独立支持本地推理。
- 通过生产 `dist/knowledge` 编程 API 添加中文水果与发动机资料，关闭并重开临时 `knowledge.db` 后查询“水果的营养成分”，水果条目以 `0.9075519` 高于发动机条目的 `0.8028622` 排在首位；临时数据库已清理。
- 正式知识库已导入用户提供的 R01–R25 校园办事资料，共 25 条知识、25 个真实向量切片，完整保留分类、入口、流程、部门/角色、材料要求和备注；关闭重开后数量校验一致。真实语义检索中，“宿舍门锁坏了怎么报修”以 `0.9092` 命中 R02，“入团志愿书和支部大会怎么办理”以 `0.8781` 命中 R04，“课程免听怎么申请”以 `0.9245` 命中 R16，三条均为首位结果。临时 CSV 已删除，正式知识条目保留。
- 通过生产 `edit_knowledge` 将 R02 更正为“学校账号飞书 → 物业工作台 → 提交宿舍报修申报”，正文与 metadata 同步更新，未虚构申报后的具体环节；关闭重开后 25 条知识完整，“宿舍门锁坏了怎么报修”仍以 `0.9033` 将 R02 排在首位，返回内容已包含物业工作台。自动化同时覆盖编辑保留创建时间/标题/metadata、向量更新、参数校验及事务失败时旧正文与旧向量回滚。
- `add_knowledge` 自动化覆盖完整正文与 metadata 转发、省略 ID 后返回系统生成 ID、写工具属性、缺少正文时参数校验，以及 QQ 默认会话中的工具注册；本轮未向正式校园库新增额外测试数据。
- 使用真实 LLM、生产 Agent 和临时“测试学校学生证补办指南”验证完整校园链路：模型无需用户要求即自动调用 `search_knowledge`，并根据返回切片给出挂失、补办步骤、一寸照片、学生事务中心 103 室、办理时间、领取方式和信息来源；临时数据库与会话已清理，未写入真实校园资料。
- 正式知识库已通过生产 `dist/knowledge` 完成 schema v1 → v2 迁移，R01–R25 无缺失，检查到的既有及后续新增条目均归为 `student`，未删除或重置现有资料。学生检索“宿舍门锁坏了怎么报修”以 `0.9137` 命中 R02，领导执行相同检索返回 0 条；当前角色无切片时不会加载 Embedding。

真实 API（非 mock）已验证：

- Anthropic 调用 `read_file` 读取 `README.md` 生成项目总结，读取 `.gitignore` 给出配置建议。
- OpenAI Responses 通过 `function_call` / `function_call_output` 完成同样的文件读取与总结。
- 真实 MiniMax `MiniMax-M3.1-Flash`（Anthropic 协议）以 `output_config.effort=low` 完成短请求，服务接受档位并正常返回 thinking 与 text；该验证只确认协议生效，不以耗时判断档位。
- 真实 Agent 在时间注入后回答 `2026年10月30日 10:53:33（Asia/Taipei，UTC+8）`，与运行环境一致；对应 SQLite 用户消息仍为原始问题，未包含时间前缀。
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
- agentnew Web UI 整合已通过真实 Vite 生产构建（113 个模块）及本机生产接口验证：首页包含校园小管家品牌，chat/curation state 与 history 均正常，`GET /api/connection` 不含 api_key。真实策展 Agent 成功调用 `read_skill`、检索校园资料并生成方案；原始输入未混入隐藏提示，归档后普通聊天读取该会话返回 404，结果为 `PRODUCTION_CURATION_OK skill=read_skill raw_input=true archived=true cross_scope=404`。按项目规则未进行浏览器手动测试。`npm run all` 已重启，Web UI 与微信正常；本次 NapCat `127.0.0.1:3001` 返回 ECONNREFUSED，QQ 进程保持自动重连，需启动 NapCat 后恢复收发。
- 命令审核复用主模型（Anthropic 协议 → MiniMax `MiniMax-M3.1-Flash`）以独立请求逐条验证，单次约 1–2 秒：`echo hello > note.txt`、`curl` GET 判为不危险而放行；`rd /s /q .`、写入 `C:\Windows` 判为危险而拒绝；内嵌「忽略上文」与伪造 JSON 的命令仍按命令本身判定。此前经 chat/completions 直连同一模型也验证了 `npm install` 放行，读取 SSH 私钥与 `del ..\secret.txt` 拒绝。
- 使用真实 `MemoryService`、内存 SQLite 和独立生产实例完成两轮归档：两条归档均保存非空标题/摘要并出现在 `/api/history`，只读消息完整返回且当前会话 ID 不变；模拟总结失败时接口返回错误，旧会话保持 active 且不创建新会话。验证实例与临时文件已清理。
- 2026-11-10 执行一次性保守清理：已在项目外留存并校验记忆库备份，清空全部历史会话、消息、摘要及对话 FTS；知识库及其向量、核心记忆、表情包和 iLink 登录状态均保留，数据库完整性与外键检查通过。同时移除旧压缩包、可再生 `dist` 与二维码，未调整源码结构。

## 下一步

1. 继续使用 `KnowledgeService` 编程 API 补充学生与领导知识，并按实际数据规模评估是否需要向量索引。临时 `edit_knowledge` 在后续不再需要 Agent 编辑知识时移除。
2. 在真实 QQ 群中验收普通消息静默、@ 回复、近期群上下文、同角色共享与跨角色隔离，再按需要实现 QQ 多媒体、合并连发和回复限速。
3. 使用真实微信验收 iLink 私聊收发、重启去重与白名单，再按协议演进复核 SDK 2.4.10 字段；媒体、群聊和主动推送不在当前能力范围内。
4. 通过 CLI 持续验证真实对话、工作区操作和长期记忆效果。
5. 之后再考虑主动画像推荐、经验贡献闭环、远程 MCP、OAuth、动态刷新和 OS 沙箱。

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

WEB_SEARCH_MODE=local            # local：Tavily + 直连抓取；deepseek：官方 Search/Fetch
TAVILY_API_KEY=                  # local 搜索需要；未配置仅隐藏 web_search
DEEPSEEK_API_KEY=                # deepseek 模式需要；未配置隐藏两个网页工具
DEEPSEEK_BASE_URL=https://api.deepseek.com
WEB_SEARCH_PROXY_URL=            # 可选；默认 HTTP(S) 代理，AI 可用 proxy_url 覆盖

KNOWLEDGE_DATABASE_PATH=         # 可选；默认 src/data/knowledge/knowledge.db
KNOWLEDGE_MODEL_CACHE_DIR=       # 可选；默认 src/data/knowledge/model_cache

BRIDGE_ROLE=student               # CLI/Web 当前知识角色；或 leader
BRIDGE_LEADER_IDS=[]              # QQ/iLink 领导身份 JSON 数组，如 ["qq:123456"]

ILINK_STATE=src/data/ilinkbot/state.json # 可选；敏感登录状态，禁止提交
ILINK_ALLOW=                      # 可选；逗号分隔微信用户 ID，空则仅扫码人

ONEBOT_WS_URL=ws://127.0.0.1:3001 # 可选；NapCat OneBot v11 正向 WebSocket
ONEBOT_ACCESS_TOKEN=             # 可选；通过 Authorization: Bearer 发送
ONEBOT_OWNER_QQ=                 # 可选；唯一可通过 QQ 修改核心记忆的 QQ 号
```

## 相关文档

- 项目说明与使用指南：[README.md](../README.md)
- 项目协作与 Git 身份规则：[AGENTS.md](../AGENTS.md)
- MiniMax-M3.1-Flash 思考强度实测（不可关闭思考，可选 low–max，默认接近 high）：[effort.md](../effort.md)
- 记忆设计：[src/memory/DESIGN.md](../src/memory/DESIGN.md)
- 工具调用设计：[src/tools/tool_calling/DESIGN.md](../src/tools/tool_calling/DESIGN.md)
- 工作区管理：[src/tools/tool_calling/workspace_manager.md](../src/tools/tool_calling/workspace_manager.md)
- OpenAI 适配器：[src/llm/openai/README.md](../src/llm/openai/README.md)
- Anthropic 适配器：[src/llm/anthropic/README.md](../src/llm/anthropic/README.md)
