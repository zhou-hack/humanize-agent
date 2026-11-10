const TOOL_LABELS = {
  read_file: ['→', '查看文件'],
  edit_file: ['±', '修改文件'],
  find_path: ['→', '查找路径'],
  search_text: ['→', '搜索内容'],
  stat_path: ['i', '查看信息'],
  list_directory: ['→', '浏览文件夹'],
  create_directory: ['+', '新建文件夹'],
  move_path: ['→', '移动文件'],
  delete_path: ['×', '删除文件'],
  get_workspace_directory: ['⌂', '确认工作区'],
  run_command: ['>', '执行命令'],
  web_search: ['↗', '联网搜索'],
  web_fetch: ['↗', '读取网页'],
  read_skill: ['↗', '读取技能'],
  search_knowledge: ['→', '检索知识库'],
  edit_knowledge: ['±', '编辑知识库'],
  add_knowledge: ['+', '添加知识'],
  remember: ['+', '写入记忆'],
  search_memory: ['→', '检索记忆'],
  list_memory: ['→', '回忆'],
  forget_memory: ['–', '遗忘'],
  get_conversation: ['→', '翻阅旧对话'],
  save_sticker: ['+', '保存表情包'],
  search_stickers: ['→', '查找表情包'],
  send_sticker: ['↗', '发送表情包']
}

export function getToolLabel(name) {
  const [icon, label] = TOOL_LABELS[name] ?? ['·', '处理中']
  return { icon, label }
}

export function getToolSummary(args) {
  if (!args || typeof args !== 'object') return ''
  if (typeof args.path === 'string' && args.path) {
    const parts = args.path.split(/[\\/]/).filter(Boolean)
    return parts.at(-1) ?? args.path
  }
  for (const key of ['query', 'pattern', 'content', 'url', 'name']) {
    if (typeof args[key] === 'string' && args[key]) {
      const text = args[key].replace(/\s+/g, ' ').trim()
      return text.length > 20 ? `${text.slice(0, 20)}…` : text
    }
  }
  return ''
}
