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
- 默认无 shell 的 `workspace` 模式，以及逐条审批命令的 `approval` 模式。

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

- `workspace`（默认）：不注册 shell 或 git。提供 `ls/dir`、`pwd`、读取、编辑、搜索、`mkdir`、移动和删除等专用工具，所有文件操作都限制在当前工作区内。
- `approval`：额外注册 `run_command`，每条 shell 命令都需要人工审批。shell 不构成文件系统或网络沙箱，审批前应核对命令和目录。
- `open`：暂未在 CLI 开放。

非空目录只有显式设置 `recursive=true` 才能递归删除；禁止删除工作区根目录、越界操作和覆盖已有移动目标。

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