<script setup>
import { ref, watch, nextTick } from 'vue'
import MessageItem from './MessageItem.vue'
import PermSwitch from './PermSwitch.vue'
import EffortSlider from './EffortSlider.vue'

const props = defineProps({
  msgs: { type: Array, required: true },
  running: Boolean,
  newChatBusy: Boolean,
  collapsed: Boolean,
  effort: { type: String, default: 'high' },
  modelName: { type: String, default: '' },
  mode: { type: String, default: 'workspace' },
  modeBusy: Boolean,
  workspace: { type: String, default: '' }
})
const emit = defineEmits(['send', 'stop', 'decide', 'toggle-bench', 'update:mode', 'update:effort', 'change-workspace'])

const draft = ref('')
const listEl = ref(null)

function send() {
  const text = draft.value.trim()
  if (!text || props.running || props.newChatBusy) return
  emit('send', text)
  draft.value = ''
}

function onEnter(e) {
  if (e.shiftKey || e.isComposing) return
  e.preventDefault()
  send()
}

watch(() => props.msgs, () => {
  nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}, { deep: true })

function isLastOfGroup(i) {
  const m = props.msgs[i]
  if (!m || (m.kind !== 'user' && m.kind !== 'agent')) return false
  const next = props.msgs[i + 1]
  return !next || next.kind !== m.kind
}
</script>

<template>
  <section class="pane">
    <header class="head">
      <span class="dot" :class="{ run: running }"></span>
      <h1>Agent 对话</h1>
      <button
        class="ws"
        :title="running ? '任务运行期间不能切换工作区' : '点击切换工作区'"
        :disabled="running || !workspace"
        @click="emit('change-workspace')">
        {{ workspace || '正在连接工作区' }}
      </button>
      <button @click="emit('toggle-bench')">{{ collapsed ? '工作台' : '收起' }}</button>
    </header>

    <div class="msgs" ref="listEl">
      <div class="empty" v-if="!msgs.length">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <div class="empty-title">开始一个任务</div>
        <div class="empty-desc">输入任务并发送，右侧会即时显示 Agent 的真实工具调用与执行结果</div>
      </div>
      <TransitionGroup name="msg">
        <MessageItem
          v-for="(m, i) in msgs"
          :key="m.id"
          :msg="m"
          :is-last="isLastOfGroup(i)"
          @decide="(id, ok) => emit('decide', id, ok)" />
      </TransitionGroup>
    </div>

    <div class="composer">
      <textarea
        v-model="draft"
        class="composer-input"
        placeholder="给 Agent 发送消息…"
        rows="2"
        @keydown.enter="onEnter"></textarea>
      <div class="composer-toolbar">
        <PermSwitch
          :mode="mode"
          :disabled="running || newChatBusy || modeBusy"
          @update:mode="m => emit('update:mode', m)" />
        <span class="grow"></span>
        <EffortSlider
          :effort="effort"
          :disabled="running || newChatBusy"
          :model-name="modelName"
          @update:effort="value => emit('update:effort', value)" />
        <button
          class="composer-send"
          :class="running ? 'danger' : 'primary'"
          :title="running ? '中止' : '发送'"
          :aria-label="running ? '中止' : '发送'"
          :disabled="newChatBusy || (!running && !draft.trim())"
          @click="running ? emit('stop') : send()">
          <svg v-if="!running" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
          <svg v-else class="icon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
        </button>
      </div>
    </div>
  </section>
</template>
