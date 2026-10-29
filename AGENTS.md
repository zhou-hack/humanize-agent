# AGENTS.md

## 严格项目规则

### 1. 每次更新必须同步项目概览

- 每次修改、新增、删除或重构项目中的任何内容，都必须同步更新 `docs/overview.md`。
- `docs/overview.md` 必须反映更新后的真实状态，包括涉及的模块、功能变化、使用方式、环境变量和下一步计划；没有变化的部分不需要强行改写。
- 不得只修改代码而遗漏概览文档。完成工作前必须检查这项要求。

### 2. Git Author 和 Committer 身份固定

Git 的作者（Author）和提交者（Committer）都只能使用以下身份：

```text
zhou-hack <wangyimrzhou@163.com>
```

- 禁止出现 `trae-solo-agent` 或任何其他 Author/Committer 身份。
- 尤其注意：运行环境可能把 Committer 覆盖为 `trae-solo-agent`。这种提交即使本地显示签名有效，也无法通过 GitHub 的已验证签名要求，必须修正后再推送。
- 不得通过关闭签名、跳过钩子或强制推送来绕过限制。

提交时如发现环境身份不一致，仅为当前提交命令固定以下变量，不修改全局 Git 配置：

```powershell
$env:GIT_AUTHOR_NAME='zhou-hack'
$env:GIT_AUTHOR_EMAIL='wangyimrzhou@163.com'
$env:GIT_COMMITTER_NAME='zhou-hack'
$env:GIT_COMMITTER_EMAIL='wangyimrzhou@163.com'
```

### 3. 提交和推送前必须核验

每次提交后、推送前都必须执行：

```powershell
git log -1 --show-signature --format=fuller HEAD
```

确认以下三项全部满足后才允许推送：

1. Author 是 `zhou-hack <wangyimrzhou@163.com>`。
2. Committer 也是 `zhou-hack <wangyimrzhou@163.com>`，不是 `trae-solo-agent`。
3. 签名显示为有效，并且签名身份与上述邮箱一致。

如果任一项不满足，不得推送；必须先在本地修正提交身份和签名。
