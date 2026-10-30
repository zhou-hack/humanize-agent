import { ref, watch } from 'vue'
import { getState, postJson, streamAgentRun } from '../api'

let seq = 0
const uid = () => 'm' + (++seq)
const EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const EFFORT_STORAGE_KEY = 'humanize-effort'

function readStoredEffort() {
  try {
    const value = typeof localStorage === 'undefined' ? null : localStorage.getItem(EFFORT_STORAGE_KEY)
    return EFFORT_VALUES.includes(value) ? value : 'high'
  } catch {
    return 'high'
  }
}

export function useAgentRun() {
  const msgs = ref([])
  const steps = ref([])
  const tokens = ref(0)
  const status = ref('连接中')
  const running = ref(false)
  const newChatBusy = ref(false)
  const effort = ref(readStoredEffort())
  const model = ref('')
  const mode = ref('workspace')
  const modeBusy = ref(false)
  const workspace = ref('')

  watch(effort, (value) => {
    try {
      if (EFFORT_VALUES.includes(value)) localStorage.setItem(EFFORT_STORAGE_KEY, value)
    } catch {
      // 存储不可用时仅保留当前页面内的选择
    }
  })

  let activeController = null
  let streamingEl = null
  let thinkingEl = null

  function endThinking() {
    if (thinkingEl) thinkingEl.streaming = false
    thinkingEl = null
  }

  function dispatch(ev) {
    switch (ev.type) {
      case 'run_start':
        running.value = true
        status.value = '执行中'
        break

      case 'thinking_delta':
        streamingEl = null
        if (!thinkingEl) {
          msgs.value.push({ id: uid(), kind: 'thinking', text: '', streaming: true })
          thinkingEl = msgs.value[msgs.value.length - 1]
        }
        thinkingEl.text += ev.text
        break

      case 'message_delta':
        endThinking()
        if (!streamingEl) {
          msgs.value.push({ id: uid(), kind: 'agent', text: '', streaming: true })
          streamingEl = msgs.value[msgs.value.length - 1]
        }
        streamingEl.text += ev.text
        break

      case 'tool_call':
        endThinking()
        streamingEl = null
        steps.value.push({
          id: ev.callId,
          name: ev.name,
          args: ev.args,
          status: 'running',
          output: '',
          duration: 0
        })
        msgs.value.push({ id: uid(), kind: 'chip', text: `调用 ${ev.name}` })
        break

      case 'tool_result': {
        const step = steps.value.find(s => s.id === ev.callId)
        if (step) {
          step.status = ev.result.ok ? 'ok' : 'err'
          step.output = formatOutput(ev.result.ok ? ev.result.data : ev.result.error)
        }
        break
      }

      case 'approval_request': {
        streamingEl = null
        const step = [...steps.value].reverse().find(s => s.name === 'run_command' && s.status === 'running')
        if (step) step.status = 'wait'
        status.value = '等待确认'
        msgs.value.push({
          id: uid(),
          kind: 'approval',
          callId: ev.approvalId,
          command: ev.command,
          cwd: ev.cwd,
          risk: ev.risk,
          resolved: null
        })
        break
      }

      case 'run_end':
        finishRun(ev.status, ev.message)
        if (ev.usage) tokens.value += ev.usage.inputTokens + ev.usage.outputTokens
        if (ev.truncated) msgs.value.push({ id: uid(), kind: 'system', text: '回答可能被截断' })
        break
    }
  }

  async function initialize() {
    applyState(await getState())
    status.value = running.value ? '执行中' : '待命'
  }

  async function setMode(next) {
    if (running.value || modeBusy.value || next === mode.value) return
    modeBusy.value = true
    try {
      applyState(await postJson('/api/permission', { mode: next }))
    } finally {
      modeBusy.value = false
    }
  }

  async function run(text) {
    if (!text?.trim() || running.value || newChatBusy.value) return
    const runEffort = effort.value === 'ultra' ? 'max' : effort.value
    steps.value = []
    streamingEl = null
    thinkingEl = null
    running.value = true
    status.value = '执行中'
    msgs.value.push({ id: uid(), kind: 'user', text: text.trim() })
    activeController = new AbortController()

    try {
      await streamAgentRun(text.trim(), {
        signal: activeController.signal,
        effort: runEffort,
        onEvent: dispatch
      })
      if (running.value) finishRun('done')
    } catch (error) {
      if (running.value) {
        const aborted = activeController.signal.aborted
        finishRun(aborted ? 'aborted' : 'error', aborted ? undefined : error.message)
      }
    } finally {
      activeController = null
      running.value = false
    }
  }

  async function stop() {
    if (!running.value) return
    status.value = '正在中止'
    try {
      await postJson('/api/runs/stop')
    } finally {
      activeController?.abort()
    }
  }

  async function decide(callId, approved) {
    const msg = msgs.value.find(m => m.kind === 'approval' && m.callId === callId)
    if (!msg || msg.resolved) return
    msg.resolved = approved ? 'ok' : 'no'
    try {
      await postJson('/api/approvals', { id: callId, approved })
    } catch (error) {
      msg.resolved = null
      msgs.value.push({ id: uid(), kind: 'system', text: `审批提交失败：${error.message}` })
    }
  }

  async function changeWorkspace(path) {
    if (running.value) return
    applyState(await postJson('/api/workspace', { path }))
  }

  async function newChat() {
    if (running.value || newChatBusy.value) return false
    newChatBusy.value = true
    try {
      const state = await postJson('/api/chat/new')
      resetLocal()
      applyState(state)
      return true
    } finally {
      newChatBusy.value = false
    }
  }

  function applyState(state) {
    mode.value = state.permission
    model.value = state.model || ''
    workspace.value = state.workspace.current_directory
    running.value = state.running
  }

  function finishRun(result, message) {
    running.value = false
    status.value = result === 'done' ? '完成' : result === 'aborted' ? '已中止' : '错误'
    streamingEl = null
    thinkingEl = null
    msgs.value.forEach(m => { if (m.streaming) m.streaming = false })
    steps.value.forEach(s => {
      if (s.status === 'wait') {
        s.status = 'err'
        s.output = s.output || '用户已中止'
      }
    })
    if (result === 'aborted') msgs.value.push({ id: uid(), kind: 'system', text: '对话已中止' })
    if (result === 'error') msgs.value.push({ id: uid(), kind: 'system', text: message || '执行失败' })
  }

  function resetLocal() {
    msgs.value = []
    steps.value = []
    tokens.value = 0
    status.value = '待命'
    streamingEl = null
    thinkingEl = null
  }

  return {
    msgs, steps, tokens, status, running, newChatBusy, effort, model, mode, modeBusy, workspace,
    initialize, setMode, run, stop, decide, changeWorkspace, newChat
  }
}

function formatOutput(value) {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
