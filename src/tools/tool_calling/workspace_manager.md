# Workspace Manager

## 目标

管理 Agent 当前使用的工作目录：

- 启动时使用默认项目目录。
- 用户选择另一个文件夹后，基本文件操作切换到该目录。
- 可以随时恢复默认目录。
- 文件工具和命令工具使用同一个当前目录。

这不是权限审批或目录授权系统。目录由可信界面或 Agent 主程序选择，模型不能自行传入绝对路径切换目录。

## 模块入口

```ts
import {
  createWorkspaceManager,
  ToolExecutor,
  ToolRegistry
} from './tools/tool_calling/index.js'
```

实现文件：`workspace_manager.ts`。

## API

### `createWorkspaceManager(options)`

创建一个目录管理器。`defaultDirectory` 必须是已存在的绝对目录，内部会转换为 canonical path。

```ts
const manager = await createWorkspaceManager({
  defaultDirectory: projectDirectory
})
```

### `manager.getSnapshot()`

返回可信界面使用的目录状态：

```ts
{
  default_directory: string
  current_directory: string
  is_default: boolean
}
```

这些绝对路径用于宿主界面，不自动注入模型上下文。

### `manager.selectDirectory(directory)`

选择新的当前目录。目录必须已存在且为绝对路径，否则抛出错误并保持原状态。

```ts
await manager.selectDirectory(userSelectedDirectory)
```

### `manager.useDefaultDirectory()`

恢复创建管理器时的默认目录。

```ts
manager.useDefaultDirectory()
```

### `manager.createTools(options?)`

根据调用时的当前目录创建一套新工具：

- 默认提供 `list_directory`、`read_file`、`search_text`、`edit_file`。
- `mode: 'approval'` 时额外提供需要用户审批的 `run_command`。
- `mode: 'open'` 时额外提供直接执行的 `run_command`。

```ts
const definitions = await manager.createTools({ mode: 'workspace' })
const registry = new ToolRegistry(definitions)
const executor = new ToolExecutor(registry)
```

## 目录切换流程

```ts
const manager = await createWorkspaceManager({
  defaultDirectory: projectDirectory
})

// 初始使用默认目录
let registry = new ToolRegistry(await manager.createTools())
let executor = new ToolExecutor(registry)

// 用户在界面中选择文件夹后，由可信代码调用
await manager.selectDirectory(userSelectedDirectory)

// 重新创建工具，使后续调用绑定新目录
registry = new ToolRegistry(await manager.createTools())
executor = new ToolExecutor(registry)
```

已创建的工具定义绑定创建时的目录，不会随着管理器状态自动变化。因此：

1. 切换前等待当前工具调用完成。
2. 调用 `selectDirectory` 或 `useDefaultDirectory`。
3. 重新创建 `ToolRegistry` 和 `ToolExecutor`。
4. 后续 Agent 请求使用新实例。

不要混用切换前后的 executor，否则旧 executor 仍会操作旧目录。

## 路径边界

- 默认目录和选择目录都复用 `createWorkspace` 的 canonical 校验。
- 模型只传工作区内的相对路径。
- `list_directory`、`read_file`、`search_text`、`edit_file` 拒绝路径穿越和符号链接逃逸。
- `approval` 和 `open` 模式的 shell 命令以当前目录作为初始 cwd，但不构成文件系统沙箱。

## 当前边界

- 同一时间只有一个当前目录，不同时开放多个目录。
- 不保存用户选择；进程重启后由宿主重新设置默认目录或上次选择。
- 不提供目录授权、只读/读写分级或授权期限。
- 不允许模型直接调用管理器切换目录；只向可信界面或 Agent 主程序暴露管理器。
