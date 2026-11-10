# humanize-agent

一个具备长期记忆、真实工具调用和本机 Web UI 的 TypeScript Agent。

humanize-agent 会把持续交互中有价值的信息保存下来，并在后续对话中自然使用。项目包含三级记忆、Agent 主循环、工作区文件工具、命令权限控制、交互 CLI、接入真实 Agent 的 Vue Web UI、OneBot v11 / NapCatQQ 私聊群聊，以及微信 iLink Bot 私聊入口。

> 项目仍在开发中，接口和行为可能调整。请勿直接用于生产环境或处理敏感信息。

## 功能概览

- **三级记忆**：`MEMORY.md` 核心记忆、近 72 小时会话索引、可检索的长期历史。
- **本地向量知识库**：独立 SQLite、中文多语言 Embedding、文本切片和余弦语义检索，无需远程 Embedding API。
- **完整 Agent 循环**：连续对话、流式输出、思考增量、工具多轮调用、取消超时和会话恢复。
- **三种模型协议**：Anthropic Messages、OpenAI Responses、OpenAI Chat Completions。
- **工作区工具**：读取、编辑、搜索、路径查询、建目录、移动和删除，支持工作区切换。
- **两档权限**：`workspace` 与 `approval`，包含只读命令白名单、模型安全审核和人工审批。
- **真实 Web UI**：校园小管家品牌与极光界面、主题过渡、六档推理、SSE 对话、工具轨迹、独立活动策展、连接设置、严格归档、只读历史和安全 Markdown。
- **QQ 私聊与群 @**：OneBot v11 正向 WebSocket、array 消息段、echo RPC、自动重连、私聊隔离和同群同角色共享会话。
- **微信 iLink Bot**：扫码登录、终端及 PNG 二维码、状态持久化、长轮询、按用户隔离和被动文本回复。
- **可扩展资源**：内置 humanizer-zh 与 campus-event-curation Skill、本地 stdio MCP，以及可选的 Tavily 网页搜索。

## 快速开始

### 1. 环境要求

- Node.js >= 22.13（记忆模块使用内置 `node:sqlite`）
- npm

安装后端依赖：

```bash
npm install
```

如需使用 Web UI，再安装前端依赖：

```bash
npm --prefix src/ui install
```

### 2. 配置模型

在项目根目录创建 `.env`。该文件已被 Git 忽略，不要提交真实密钥。

使用 Anthropic Messages 协议：

```dotenv
LLM_PROVIDER=anthropic

ANTHROPIC_BASE_URL=
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_MODEL=your-model
ANTHROPIC_MAX_TOKENS=4096
```

或使用 OpenAI 协议：

```dotenv
LLM_PROVIDER=openai

OPENAI_BASE_URL=
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=your-model
OPENAI_MAX_TOKENS=4096
OPENAI_API_MODE=responses
```

`OPENAI_API_MODE` 仅支持：

- `responses`：OpenAI Responses API，默认值。
- `chat_completions`：OpenAI Chat Completions API。

项目只读取当前 `LLM_PROVIDER` 对应的配置，不提供旧变量别名，也不会在配置错误时静默切换协议。

### 3. 启动 CLI

```bash
npm run cli
```

命令会先构建 TypeScript，再进入连续对话。默认工作区：

- Windows：`~/Documents/humanize-agent-work`
- Linux / macOS：`~/humanize-agent-work`

| 命令 | 作用 |
| --- | --- |
| `/help` | 查看可用命令 |
| `/new` | 总结并归档当前会话，直接开始新对话 |
| `/cd <路径>` | 切换工作区；无参显示当前工作区 |
| `/permission [workspace\|approval]` | 无参切换权限，带参精确设置 |
| `/exit` | 退出 |
| `Ctrl+C` | 取消当前请求 |

`/new` 在 CLI、QQ 私聊与群 @、微信私聊以及 Web UI 输入框中通用：发送后立即归档当前会话并开始一段隔离的新对话，消息本身不会发给模型；归档总结失败时保留原会话并返回错误。

### 4. 启动 Web UI

```bash
npm run ui
```

打开 `http://127.0.0.1:3210`。服务仅监听本机，API 密钥、工作区文件和 SQLite 均保留在 Node 服务端。

Web UI 已接入：

- 校园小管家品牌、开场动画、极光玻璃界面、中文工具名、消息与执行轨迹动效及响应式布局。
- 从主题按钮扩散的圆形过渡和图标旋转，支持连续点击与系统“减少动态效果”设置。
- 六档推理浮层，支持拖动、键盘和直接点选，提供用途说明与当前模型信息；Ultra 仍映射到后端 `max`。
- 独立的深浅色输入区、真实流式回复、思考过程、工具轨迹、token 用量、安全 Markdown、任务停止和人工审批。
- 工作区浏览与切换，以及 `workspace/approval` 权限切换；工作区和权限会同步应用到普通聊天与活动策展，任一运行期间禁止切换。
- 新建对话严格归档当前模式会话，归档失败不会清空页面；只读历史按模式隔离，不支持修改、恢复或写入历史。

开发模式可在两个终端分别运行：

```bash
npm run ui:api   # 后端：http://127.0.0.1:3210
npm run ui:dev   # 前端：http://127.0.0.1:5173，/api 自动代理
```

仅构建产物：

```bash
npm run ui:build
```

后端输出到 `dist/ui/server/`，前端输出到 `dist/ui/web/`。

#### 校园活动策展

左侧导航可独立进入活动策展页面。普通聊天使用 `local` memory scope，活动策展使用 `ui:event-curation`；两边分别保存消息、步骤、Token、草稿、运行、审批、停止、归档和只读历史，不会互相读取。直接切换页面不会强制归档，点击“新对话”只归档当前模式。

策展 Agent 通过 `init/event-curation` 系统提示按需读取内置 `campus-event-curation` Skill，用户输入保持原文，不把隐藏 Skill 指令写入会话。Skill 已内联主题命名、预算、策划书、申请表、推文与海报模板；四问卡是六问的浓缩预问答，也保留默认值和快速通道。

#### 连接设置

右上角连接设置支持 OpenAI/Anthropic、接口地址、API Key、模型列表、协议模式、最大 Token 和温度。提供：

- `GET /api/connection`：只返回公开配置、`has_api_key` 和 `source`，不返回 API Key。
- `POST /api/connection/models`：使用临时 SDK 获取模型，10 秒超时、最多 200 条，不保存配置。
- `POST /api/connection`：原子保存并热切换 Web UI 的 Agent、会话总结和命令审核模型；任一聊天或策展运行、启动、归档期间返回 409。

配置保存到 `~/.humanize-agent/connection.json`，优先于 `.env`。API Key 不回显、不写入 localStorage；同一服务商留空会复用旧 Key，切换服务商必须重新填写。该文件以 `0600` 权限明文保存密钥，Windows 上不能把该 mode 当作加密或完整 ACL 保护，请仅在本机可信环境使用。保存只创建客户端，不代表已验证连通性。配置热切换只影响 Web UI，QQ 和微信仍使用启动时的 `.env`。

### 5. 启动 QQ 私聊与群 @（OneBot v11 / NapCatQQ）

在 NapCatQQ 中启用 OneBot v11 正向 WebSocket 服务，并将消息格式设为 array。然后在 `.env` 中配置：

```dotenv
# NapCat 正向 WebSocket 监听地址
ONEBOT_WS_URL=ws://127.0.0.1:3001

# 可选；与 NapCat access token 保持一致，通过 Authorization: Bearer 发送
ONEBOT_ACCESS_TOKEN=

# 可选；只有这个 QQ 号可以通过 QQ 写入或删除全局核心记忆
ONEBOT_OWNER_QQ=

# 可选；领导身份 JSON 数组，名单外的 QQ 用户默认为学生
BRIDGE_LEADER_IDS=["qq:123456"]

```

启动：

```bash
npm run qq
```

当前处理私聊文本和群聊文本。所有群文本都会被接收并加入近期上下文，但只有明确 @ 机器人才进入 Agent 并回复；未 @、只 @ 其他成员或只 @ 全体均保持静默，不再进行免 @ AI 回复判断。机器人自身消息、空文本和纯非文本消息忽略，连接使用带 echo 的 OneBot RPC，断线后自动重连，群回复会 @ 发言成员。

群上下文按 `group:<群号>:<角色>` 隔离，在内存中保留最近 50 条、最多约 2 万字符，服务重启后清空。@ 机器人时，此前消息以 JSON 形式仅注入本轮模型，用于理解“他、刚才、交给谁”等指代；当前 @ 文本仍是唯一需要处理的请求。被动消息不会写入长期对话记忆，也不会自动延续到下一轮或混入其他群、角色、私聊、CLI、微信会话。

每个 QQ 用户使用独立的 `private:<QQ号>` 会话 scope，当前会话、近期索引和长期检索互不混入，也不会混入 CLI/Web 的 `local` 或微信的 `private:ilinkbot:<from_user_id>` 会话。CLI、QQ、微信都能使用同一知识库，但对话历史不跨入口共享。群聊按发言人角色使用 `group:<群号>:<角色>` scope，同角色成员共享该群的会话、历史和顺序队列，不同角色及不同群之间隔离。所有入口共享核心记忆读取；私聊中只有 `ONEBOT_OWNER_QQ` 可修改核心记忆，群会话始终不能修改核心记忆。

QQ 复用与 CLI 相同的默认 `workspace` 权限和默认工作区，因此保留 `search_knowledge`、`edit_knowledge`、`add_knowledge`、文件读取、`edit_file`、建目录、移动和删除等工具。白名单外命令仍经过模型安全审核，但 QQ 没有终端人工审批交互，需要人工审批的命令会被拒绝。群成员也沿用这些工具权限，请仅在信任私聊使用者及群成员能够操作该工作区时启用此入口。发送 `/new` 可在当前私聊或群角色会话中直接开始新对话。

运行日志直接输出到终端：

```text
[recvMessage] 10001: 宿舍门锁坏了
[think]: 先查询校园知识库
[tool] read_file: path=README.md
[files] read: read_file path=README.md
[tool] edit_file: path=notes.txt
[files] write: edit_file path=notes.txt
[tool] add_knowledge: id=R26 title=新资料
[tool] web_search: query=学校报修流程
[tools] web_search: https://example.edu/repair
[sendMessage] 10001: 先联系本楼栋宿管
```

`[think]` 在首个真实思考增量到达时立即开始，在同一行流式追加内容，遇到正文、工具事件、其他消息或发送日志时自动换行，不再每个 token 单独一行；`[tool]` 对所有工具调用输出工具名和关键参数，知识正文与文件编辑正文不会写入日志；文件读写另以 `[files]` 记录操作类型和路径；`web_search` 调用显示查询词，成功结果再通过 `[tools]` 逐条输出实际 URL；`sendMessage` 仅在 OneBot 发送成功后记录。

### 6. 启动微信私聊（iLink Bot）

在 `.env` 中配置：

```dotenv
# 可选；默认就是该路径，包含 bot_token，已被 Git 忽略
ILINK_STATE=src/data/ilinkbot/state.json

# 可选；逗号分隔的 from_user_id。为空仅允许扫码人；非空时严格按名单允许
ILINK_ALLOW=

# 可选；微信领导身份，名单外默认为学生
BRIDGE_LEADER_IDS=["ilinkbot:user@im.wechat"]
```

启动：

```bash
npm run ilinkbot
```

未登录时，终端会显示二维码，同时将同一张二维码保存为项目根目录 `ilink_qrcode.png`。使用微信扫码并在手机上确认；需要数字验证码时按终端提示输入。二维码过期会自动刷新，最多连续刷新三次。

登录成功以及后续使用已有状态启动时，会打印：

```text
[link] owner_id=xxx@im.wechat bot_id=yyy@im.bot
```

`owner_id` 是扫码人的 `ilink_user_id`，不是微信昵称；当前协议没有提供昵称字段。状态文件保存登录凭证、API 地址、长轮询游标、消息去重 ID 和每个用户的回复上下文，权限尽量设为 `0600`，不得提交或分享。需要重新扫码时，先停止服务，再删除 `ILINK_STATE` 指向的状态文件。

每个微信用户使用 `private:ilinkbot:<from_user_id>` 会话 scope，同一用户顺序处理，不同用户并行，互不混入 QQ 或 CLI/Web 历史。`BRIDGE_LEADER_IDS` 在服务端固定学生/领导知识角色。所有微信会话默认禁止修改全局核心记忆；工作区、知识库和命令权限与 QQ 相同，没有终端人工审批交互，因此只应允许信任的使用者。发送 `/new` 可直接开始新对话。

当前按官方 SDK `2.4.10` 字段实现；iLink 没有公开正式协议文档，升级前需要复核兼容性。当前仅支持一对一文本私聊和被动回复，不支持群聊、媒体或主动推送。回复使用该用户最新的 `context_token`，超过 4000 个 Unicode 字符自动分段。普通长轮询超时自动续轮，`ret/errcode=-14` 时暂停请求一小时，不自动删除凭证。终端日志格式与 QQ 一致，微信用户带 `ilinkbot:` 前缀，token、二维码 key 和 context_token 不写入日志。

### 同时启动 Web UI、QQ 和微信

```bash
npm run all
```

该命令先构建后端和 Web UI，再通过 `scripts/start_all.mjs` 同时启动三个服务。Web UI 地址仍为 `http://127.0.0.1:3210`；按 `Ctrl+C` 停止全部服务，任一服务退出时其余服务也会停止。

## 记忆与会话

记忆数据默认保存在 `src/data/memory/`，由 SQLite 单库和 `MEMORY.md` 组成，不维护多套存储之间的同步逻辑。

- **核心记忆**：新会话注入稳定、长期有效的用户偏好和重要事实。
- **短期记忆**：新会话注入近 72 小时已总结会话的标题与摘要索引。
- **长期记忆**：更早历史不自动注入，由 Agent 按需进行全文检索和时间分页。
- **会话归档**：Web UI 新建对话时，严格按照“总结成功 → 关闭旧会话 → 创建新会话”执行；总结失败会保留原会话和页面现场。
- **时间上下文**：每条用户消息发往模型前都会注入当前本地时间、UTC 偏移和时区；SQLite 仍保存用户原文，不写入时间前缀。

工具结果和网页内容按不可信输入处理，不能直接成为核心记忆写入依据。

## 本地向量知识库

知识库独立于对话记忆，默认保存在 `src/data/knowledge/knowledge.db`。条目保存原始正文、metadata 和文本切片，切片向量以 Float32LE BLOB 存在同一 SQLite 数据库中。

- 使用本地 `Xenova/multilingual-e5-small` ONNX 模型生成 384 维向量，支持中英文资料。
- 文本按约 1200 个 Unicode 字符切片并保留 200 字符重叠，检索使用精确余弦相似度，默认返回 5 条、最多 8 条结果。
- CLI、Web UI、QQ 私聊/群聊和微信 iLink 私聊都注册 `search_knowledge`、`edit_knowledge` 与 `add_knowledge`。检索结果按不可信资料处理；`add_knowledge` 仅在用户明确要求添加独立新资料时使用，ID 可省略并自动生成，不能修改已有条目；`edit_knowledge` 是按当前需求临时开放的写工具，仅在用户明确要求修改指定资料时使用，按现有 ID 替换完整正文并重新生成向量，省略 title 或 metadata 时保留旧值，不能新增或删除条目，后续可移除。
- Embedding 推理完全在本机进行，不调用远程 Embedding API。首次实际使用时需要下载模型到本地缓存；检测到完整 revision 缓存后直接从本地目录加载，不请求远端元数据，可离线使用。启动服务和检索空库不会加载模型。

### 校园问答自动流程

每次新会话都会通过 `init.md#knowledge` 注入校园检索规则。用户询问校园服务、学校制度、办事流程、校园地点或部门联系方式时，Agent 必须先自动调用 `search_knowledge`，无需用户手动要求查询；普通问候和无关问题不进行多余检索。

```text
校园问题 → 自动向量检索 → 相关知识切片 → 结论与办理步骤 → 信息来源
```

回答按“结论 → 办理步骤 → 所需材料、办理地点和时间 → 信息来源”组织。资料未提供的字段会明确说明，结果不足时回答“当前校园知识库暂无足够可靠的资料”，不编造学校政策、部门、地点或联系方式。

### Bridge 学生 / 领导隔离

当前版本只在用户提问时自动进行相似知识检索，不做主动推送或用户画像推荐。知识条目通过 `audience=student|leader` 隔离，Agent 不能通过参数切换角色：

- 学生只能检索、编辑和新增学生资料，领导只能访问领导资料；跨角色编辑按条目不存在处理。
- CLI/Web 通过 `BRIDGE_ROLE` 设置当前角色，默认 `student`。
- QQ 使用 `BRIDGE_LEADER_IDS` 判定发言人角色；名单外默认为学生。
- QQ 私聊仍按用户隔离；群聊使用 `group:<群号>:<角色>`，同角色成员共享会话，不同角色在同群也不共享历史或知识。
- 群回复本身对所有成员可见，因此群聊角色隔离不是保密边界。领导敏感资料应只在私聊或独立领导群中使用。
- 现有 R01–R25 在 schema v2 迁移时统一归为 `student`，领导库需要另行导入或添加资料。

```dotenv
BRIDGE_ROLE=student
BRIDGE_LEADER_IDS=["qq:123456","ilinkbot:user@im.wechat"]
```

微信 iLink Bot 使用 `ilinkbot:<from_user_id>` 身份格式，与协议中的 `from_user_id` 一一对应，并通过同一 `BRIDGE_LEADER_IDS` 判定知识角色。扫码登录、`getupdates` 长轮询、`context_token` 回复及状态持久化由 `npm run ilinkbot` 入口提供；iLink 仅支持私聊且不能主动推送。

### 环境变量

```dotenv
# 可选：自定义知识库与模型缓存位置
KNOWLEDGE_DATABASE_PATH=
KNOWLEDGE_MODEL_CACHE_DIR=
```

### 编程写入与检索

构建后可使用编程 API 导入自己的数据：

```js
import { KnowledgeService } from './dist/knowledge/index.js'

const knowledge = new KnowledgeService()
try {
  await knowledge.add({
    id: 'project-overview',
    title: '项目说明',
    text: '这里替换为你的知识正文',
    metadata: { source: 'manual' },
    audience: 'student'
  })

  // 编辑已有条目；title 和 metadata 省略时保留旧值，正文与向量一起替换
  await knowledge.edit({
    id: 'project-overview',
    text: '这里替换为更正后的完整知识正文'
  })

  const results = await knowledge.search({
    query: '项目如何工作？',
    audience: 'student',
    limit: 5,
    minScore: 0.2
  })
  console.log(results)

  // 需要删除时：await knowledge.delete('project-overview')
} finally {
  await knowledge.close()
}
```

新增和编辑均使用独立事务，编辑会保留原 ID 与创建时间，并在同一事务中替换正文和全部向量切片；失败时保留旧条目与旧向量。模型或向量维度与已有知识不兼容时会拒绝混用。第一版面向中小规模知识库，尚未引入 `sqlite-vec` 或近似向量索引。

## 权限与命令审核

### 权限模式

| 模式 | 行为 |
| --- | --- |
| `workspace`（默认） | 提供工作区内的专用文件工具和只读命令白名单；白名单外命令经模型审核，不危险才执行，危险或审核失败直接拒绝。 |
| `approval` | 继承 `workspace` 能力，并允许本机绝对路径的非敏感只读查看；白名单外命令经模型审核，不危险直接执行，危险或审核失败转人工审批。 |

只读白名单使用固定 argv 和路径预检，不经过 shell。管道、重定向、串接、命令代换、可写参数和敏感路径不会借白名单直接执行。专用文件工具禁止越界、删除工作区根目录或覆盖移动目标；非空目录必须显式设置 `recursive=true` 才能递归删除。

### 模型自动审核

白名单外命令会由当前主模型进行一次独立审核。审核请求只包含判定规则和命令原文，不带会话历史、记忆或工具，也不写入对话记录。

| 模式 | `dangerous=false` | `dangerous=true` | 审核超时或失败 |
| --- | --- | --- | --- |
| `workspace` | 在工作区内执行 | 拒绝 | 拒绝 |
| `approval` | 直接执行 | 人工审批并标记高风险 | 人工审批 |

批量删除、提权、敏感信息读取或外传、工作区外写入和全局配置修改等会被视为危险。模型审核、固定 argv 和路径预检都不是 OS 沙箱；执行前仍应核对命令、工作目录与潜在影响。

## 提示词

**Everything can be configured.** 系统提示、每次对话注入和独立任务提示都可以直接修改，无需改动 Agent 主循环。

固定提示词集中在 `src/prompt/`，不再散落在业务代码中：

```text
src/prompt/
├── loader.ts
├── init.md          # 初始化系统提示、权限、工作区、Skill 和记忆包装
├── session.md       # 每条消息的时间、权限通知和工具轮次注入
└── task/            # 会话摘要与命令安全审核
```

`init.md` 和 `session.md` 使用 `## 模板名` 区分区块，动态值通过 `{{variable}}` 注入。工作区路径、记忆正文、用户消息等运行数据仍由代码生成。

初始化提示词集中在一个文件中，可以直接查看和调整 Agent 的默认行为、工具规则、权限说明与记忆包装：

![init.md 中的初始化提示词配置](docs/screenshots/memory.init.png)

每次对话需要注入的内容也集中管理，包括当前时间、权限切换通知和工具轮次限制：

![session.md 中的对话注入配置](docs/screenshots/memory.session.png)

构建时模板会复制到 `dist/prompt/`，生产加载不依赖源目录或当前工作目录。

## 可选工具与扩展

### 网页搜索与抓取（local / DeepSeek）

CLI、Web UI 和 QQ 共用 `web_search` 与 `web_fetch`。通过 `WEB_SEARCH_MODE` 选择模式，默认 `local`，切换后重启服务生效：

```dotenv
# local：Tavily Search + 直接抓取网页；deepseek：DeepSeek Search/Fetch
WEB_SEARCH_MODE=local

# local 搜索需要；未配置时仅隐藏 web_search，web_fetch 仍可使用
TAVILY_API_KEY=

# deepseek 模式需要；未配置时两个网页工具都隐藏，不会静默回退 local
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com

# 可选：两种模式共用的默认 HTTP(S) 代理
WEB_SEARCH_PROXY_URL=
```

`local` 表示由项目直接请求搜索 API 和目标网页，不是离线搜索：

- `web_search` 保留 Tavily 的 `query`、1–20 条结果、四档 `search_depth` 和可选 answer。
- `web_fetch` 直接抓取 HTTP(S) HTML 或文本网页，HTML 使用 Turndown 转换为 Markdown；单页限制 2 MiB，返回正文限制 10 万字符。

`deepseek` 使用官方 [Search 与 Fetch API](https://api-docs.deepseek.com/zh-cn/guides/search/)：

- `web_search` 调用 `POST /v1/tools/search`，支持 1–128 个 Unicode 字符的 query、1–50 条结果、`need_content` 和 `ori_question`，返回标题、链接、摘要、正文及相关元数据。
- `web_fetch` 调用 `POST /v1/tools/fetch`，返回官方提取的 Markdown 正文。

两种模式的搜索和抓取结果都按不可信外部内容处理。`web_fetch` 仅接受不携带用户名或密码的 HTTP(S) URL。

AI 可以在单次调用中传入 `proxy_url` 覆盖默认代理，例如 `http://127.0.0.1:7890`；未传入时使用 `WEB_SEARCH_PROXY_URL`，两者都未配置则直连。仅支持不带路径、查询或片段的 HTTP(S) 代理，不支持 SOCKS。代理连接在请求结束后关闭，代理地址不会进入工具结果或错误正文。带账号密码的代理建议配置在 `.env`，避免凭据出现在工具调用参数和界面轨迹中。

### Skill

每个内置 Skill 使用独立目录：

```text
src/data/tools/skill/builtin/<name>/SKILL.md
```

文件包含 `name`、`description` frontmatter 和 Markdown 正文。系统只注入技能索引，模型通过 `read_skill` 按需读取完整正文。

#### humanizer-zh（已内置）

项目已内置 [op7418/humanizer-zh](https://github.com/op7418/humanizer-zh)（上游版本 `f4518a8`，MIT License），无需再执行 `npx skills add`。它用于编辑中文文章、评论和文档中的空话、重复及模板化表达，同时保留事实、确定程度和作者声音；它不是作者身份检测器，也不保证通过 AI 检测。

可以直接输入“请用 humanizer-zh 润色下面的文章”或“请用 humanizer-zh 润色 article.md 中的正文”。Agent 会通过 `read_skill` 按需读取完整规则。

内置资源位于 `src/data/tools/skill/builtin/humanizer-zh/`。为适配当前加载器，副本的 frontmatter 仅保留 `name` 和 `description`，未带入上游的 `allowed-tools` 与 `metadata` 字段；正文已与上游版本核对一致。许可证随资源保留并复制到构建产物。

#### campus-event-curation（已内置）

`campus-event-curation` 用于校园活动策划，覆盖主题、流程、预算、物料、人员分工、宣传节奏，以及策划书、申请表、推文和海报成稿。Web UI 活动策展页面会使用该 Skill，CLI、QQ 和微信也可按活动需求通过 `read_skill` 读取。必要 references 已内联到单一 `SKILL.md`，生产构建不依赖额外的资源读取机制。

### 本地 stdio MCP

在 `src/data/tools/mcp/builtin/servers.json` 中声明服务器。工具以 `mcp__<server>__<tool>` 注册：

- `workspace` 仅加载只读工具。
- `approval` 加载全部工具，副作用调用按写操作串行执行。
- 单个服务器加载失败会警告并跳过，不阻断其他工具。
- 工作区与权限切换复用连接，退出时统一关闭。

构建会复制 Skill、Skill 许可证和 MCP 资源到 `dist/data/tools/`。远程 HTTP、SSE、OAuth 和动态工具刷新暂未接入。

## 开发

```bash
npm test           # 全量测试
npm run typecheck  # TypeScript 类型检查
npm run build      # 构建后端并复制提示词、Skill 和 MCP 资源
npm run cli        # 启动 CLI 连续对话
npm run ui         # 启动 Web UI
npm run qq         # 启动 OneBot / NapCatQQ 私聊与群 @ 服务
npm run ilinkbot   # 启动微信 iLink Bot 私聊
npm run all        # 同时启动 Web UI、QQ 与微信
```

## 文档

- [项目概览与当前实现状态](docs/overview.md)
- [项目协作规则](AGENTS.md)
- [记忆设计](src/memory/DESIGN.md)
- [工具调用设计](src/tools/tool_calling/DESIGN.md)
- [工作区管理](src/tools/tool_calling/workspace_manager.md)