# humanize-agent

> **Never Forget a Thing.**
>
> 一个专注于长期记忆的 Agent

humanize-agent 让 Agent 在持续交互中保留有价值的信息，并在后续对话中自然使用这些信息。项目包含长期记忆、Agent 主循环、工作区文件工具和可交互 CLI。

## 注意

- 项目仍在开发中，功能将会有大变化。
- 请勿将项目用于生产环境，或处理包含敏感信息的交互。

## 已实现能力

- 三级记忆：核心记忆、近期会话索引和可检索的长期历史。
- Anthropic Messages、OpenAI Responses、OpenAI Chat Completions 三种协议适配。
- 连续对话、流式输出、会话恢复、工具调用和中断取消。
- 工作区内读取、编辑、查找、建目录、移动和删除文件。
- 默认仅放行工作区只读白名单命令的 `workspace` 模式，以及继承白名单、仅审批其他 shell 命令的 `approval` 模式。

## 环境要求

- Node.js >= 22.13（记忆模块使用内置 `node:sqlite`）
- npm

## 安装

```bash
npm install
```

在项目根目录创建 `.env`。该文件已被 Git 忽略，不要提交真实密钥。

### 使用 Anthropic 协议

```dotenv
LLM_PROVIDER=anthropic

ANTHROPIC_BASE_URL=
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_MODEL=your-model
ANTHROPIC_MAX_TOKENS=4096
```

### 使用 OpenAI 协议

```dotenv
LLM_PROVIDER=openai

OPENAI_BASE_URL=
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=your-model
OPENAI_MAX_TOKENS=4096
OPENAI_API_MODE=responses
```

`OPENAI_API_MODE` 可选值：

- `responses`：OpenAI Responses API，默认模式。
- `chat_completions`：OpenAI Chat Completions API。

只读取当前 `LLM_PROVIDER` 对应的一组配置。非法提供方或协议模式会直接报错，不会静默切换。

## 启动 CLI

```bash
npm run cli
```

启动时会先构建 TypeScript，再进入连续对话。默认工作区：

- Windows：`~/Documents/humanize-agent-work`
- Linux / macOS：`~/humanize-agent-work`

### CLI 命令

| 命令 | 作用 |
| --- | --- |
| `/help` | 查看实际可用命令 |
| `/cd <路径>` | 切换工作区；无参显示当前工作区 |
| `/permission [workspace\|approval]` | 无参切换权限，带参精确设置 |
| `/exit` | 退出 |
| `Ctrl+C` | 取消当前请求 |

### 权限模式

- `workspace`（默认）：提供读取、编辑、搜索、`mkdir`、移动和删除等专用文件工具，同时注册受限的 `run_command`。例如 `pwd`、`ls`、`cat`、`rg` 和 `git status` 等白名单命令无需审批；白名单外的命令经模型自动审核，判定不危险才执行，危险即拒绝（见下文「命令自动审核」）；所有路径参数都限制在当前工作区内。
- `approval`：包含 `workspace` 的全部专用文件工具和只读命令能力。同一套只读白名单无需审批；白名单外的命令先经模型自动审核，判定不危险（包括普通写入）直接执行，只有判定危险或审核失败时才需要人工审批，审批前应核对完整命令、工作目录和高风险警告。
- `open`：任意 shell 命令无需审批直接执行，暂未在 CLI 开放。

`workspace` 的白名单 `run_command` 只接受单命令 argv，不经过 shell；管道、重定向、串接、命令/变量代换、非白名单命令和可写参数都不会走白名单直接执行，而是交给命令自动审核，不会自动转为审批。`find -exec`、`sed -i`、`awk`、分页器、命令包装器及 `wget` 等不在直接放行范围内。敏感路径（如 `.env*`、私钥、凭据、`.git` 和运行时记忆）也会被拒绝。Git 仅开放指定只读子命令并隔离外部配置；Windows 的 `dir`、显示用 `cd`、`type`、`Get-Content`、`Select-String` 由 Node 适配器实现，不调用 `cmd` 或 PowerShell。

`curl` 只对单一 HTTP(S) URL 的 GET/HEAD 放开，支持常用的静默、错误、重定向、header、User-Agent、HTTP(S) proxy 和超时参数；固定禁止其他协议和 URL globbing。上传、写文件、自定义请求方法、本地配置及从文件读取 header 仍不会免审批。该放行允许向外部服务发送 URL 和显式 header，不等于网络隔离。

非空目录只有显式设置 `recursive=true` 才能递归删除；禁止删除工作区根目录、越界操作和覆盖已有移动目标。受限 argv 和路径预检不是 OS 沙箱；`approval/open` 的任意 shell 更不构成文件系统或网络安全边界。

### 命令自动审核

`workspace` 和 `approval` 下白名单外的命令会先由 Agent 当前使用的同一个模型做一次独立审核。审核请求只包含判定规则和命令原文，不带对话历史、记忆和工具，也不写入会话记录，无需额外配置。

判定模型返回 `readonly` 与 `dangerous`，放行只看 `dangerous`：

| 模式 | `dangerous=false` | `dangerous=true` | 审核超时（30 秒）/出错 |
| --- | --- | --- | --- |
| `workspace` | 在工作区内以系统 shell 执行 | 拒绝 | 拒绝 |
| `approval` | 直接执行，无需审批 | 转人工审批（标记高风险） | 转人工审批 |

批量删除、提权、读取或外传敏感信息、读写工作区外路径、全局安装等都会被判为危险。`.env*`、私钥等敏感路径不送审：`workspace` 直接拦截，`approval` 直接转人工审批。自动审核依赖模型判断，不等于沙箱隔离。

## Web UI

首次使用先安装 UI 依赖：

```bash
npm --prefix src/ui install
```

构建并启动真实 Agent Web UI：

```bash
npm run ui
```

打开 `http://127.0.0.1:3210`。生产服务器仅监听本机，直接托管 `dist/ui/web/`，API 密钥、工作区文件和 SQLite 均留在 Node 服务端。已接通连续对话、流式文本、真实工具轨迹、人工审批、停止、新对话及 `workspace/approval` 切换；mock、模拟思考、产物预览和历史/工具管理占位已移除。

开发模式分别启动后端和 Vite：

```bash
npm run ui:api   # http://127.0.0.1:3210
npm run ui:dev   # http://127.0.0.1:5173，/api 自动代理到后端
```

仅编译产物可执行 `npm run ui:build`，后端输出到 `dist/ui/server/`，前端输出到 `dist/ui/web/`。

## 网页搜索（可选）

在 `.env` 中配置 Tavily API Key：

```dotenv
TAVILY_API_KEY=tvly-your-api-key
```

配置后，CLI 在 `workspace` 和 `approval` 中都会注册 `web_search`；未配置或值为空时不注册，不影响其他功能。工具支持 `query`、`max_results`（默认 5，范围 1–20）、`search_depth`（`basic/advanced/fast/ultra-fast`）和 `include_answer`。请求使用 Bearer 认证和 30 秒超时，只返回标题、链接、摘要及可选 answer，不获取原始网页内容；搜索响应按不可信外部内容处理。

## 内置 Skill 与 MCP

内置资源放在 `src/data/tools/<skill|mcp>/builtin/`，加载器位于 `src/tools/skill/` 和 `src/tools/mcp/`。构建时会将 `SKILL.md` 和 JSON 清单复制到 `dist/data/tools/`。`builtin` 之外的其他同级目录预留给外置资源，外置自动加载尚未接入。

### Skill

每个技能使用独立目录：

```text
src/data/tools/skill/builtin/<name>/SKILL.md
```

文件包含 `name`、`description` frontmatter 和 Markdown 正文。CLI 只向模型注入技能索引，模型通过 `read_skill` 按需读取完整正文；正文按不可信内容处理。

### 本地 stdio MCP

在 `src/data/tools/mcp/builtin/servers.json` 中声明服务器：

```json
{
  "servers": {
    "demo": {
      "command": "node",
      "args": ["./demo/server.js"],
      "cwd": "./demo",
      "env": { "TOKEN": "${DEMO_TOKEN}" },
      "timeoutMs": 30000
    }
  }
}
```

相对 `cwd` 基于清单目录解析，密钥通过环境变量引用注入。工具以 `mcp__<server>__<tool>` 注册：

- `workspace` 仅注册 `readOnlyHint=true` 的只读 MCP 工具。
- `approval` 注册全部 MCP 工具，副作用调用按写工具串行执行，不额外弹出通用审批。
- 单服务器加载失败会警告并跳过，不阻断其他工具和对话。
- `/cd` 和权限切换复用现有连接，退出 CLI 时统一关闭。

首版不支持远程 HTTP、SSE、OAuth、自动重连和动态工具刷新。

## 开发命令

```bash
npm test           # 运行测试
npm run typecheck  # TypeScript 类型检查
npm run build      # 构建到 dist/
```

## 文档

- [项目概览](docs/overview.md)
- [项目协作规则](AGENTS.md)
- [记忆设计](src/memory/DESIGN.md)
- [工具调用设计](src/tools/tool_calling/DESIGN.md)