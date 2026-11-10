<script setup>
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
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
  workspace: { type: String, default: '' },
  settingsBusy: Boolean
})
const emit = defineEmits(['send', 'stop', 'decide', 'toggle-bench', 'update:mode', 'update:effort', 'change-workspace'])

const draft = ref('')
const listEl = ref(null)
const inputEl = ref(null)
const clock = ref('')
let clockTimer

function updateClock() {
  clock.value = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Shanghai'
  }).format(new Date())
}

function tiltTitle(event) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const rect = event.currentTarget.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width - .5
  const y = (event.clientY - rect.top) / rect.height - .5
  event.currentTarget.style.setProperty('--title-x', `${x * 6}px`)
  event.currentTarget.style.setProperty('--title-y', `${y * 5}px`)
}

function resetTitle(event) {
  event.currentTarget.style.setProperty('--title-x', '0px')
  event.currentTarget.style.setProperty('--title-y', '0px')
}

onMounted(() => {
  updateClock()
  clockTimer = setInterval(updateClock, 1000)
})
onBeforeUnmount(() => clearInterval(clockTimer))

function resizeInput() {
  const el = inputEl.value
  if (!el) return
  el.style.height = '24px'
  el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  el.style.overflowY = el.scrollHeight > 96 ? 'auto' : 'hidden'
}

watch(draft, () => nextTick(resizeInput))

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
  <section class="pane chat-pane">
    <header class="head">
      <span class="dot" :class="{ run: running }" aria-hidden="true"></span>
      <h1><span class="head-section">[01]</span>校园小管家 <em>Steward.</em></h1>
      <span class="head-meta">{{ running ? '● ONLINE' : '○ STANDBY' }}</span>
      <span class="head-meta">MODEL · {{ modelName || 'CONNECTING…' }}</span>
      <span class="head-meta">{{ clock }} GMT+8</span>
      <button
        class="ws"
        :title="settingsBusy ? '任务运行期间不能切换工作区' : '点击切换工作区'"
        :disabled="settingsBusy || !workspace"
        @click="emit('change-workspace')">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 7.5h7l2-2h9v13H3z"/></svg>
        <span class="ws-text">{{ workspace || '正在连接工作区' }}</span>
      </button>
      <button class="magnetic" @click="emit('toggle-bench')">{{ collapsed ? '工作台' : '收起' }}</button>
    </header>

    <div class="msgs" ref="listEl">
      <div class="empty" v-if="!msgs.length">
        <div class="empty-grid" aria-hidden="true"><i v-for="n in 12" :key="n"></i></div>
        <div class="empty-kicker">(00) — CAMPUS AGENT FOR STUDENT ORGANIZERS</div>
        <div class="empty-title" @pointermove="tiltTitle" @pointerleave="resetTitle">
          <span>校园大小事，</span><span>问我就对了<i>.</i></span>
        </div>
        <div class="empty-desc">活动策划、事务咨询、资料整理，都可以从下方交给校园小管家。<span class="empty-arrow">↓</span></div>
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

    <div class="composer-area">
      <div class="composer-permission">
        <PermSwitch
          :mode="mode"
          :disabled="settingsBusy || newChatBusy || modeBusy"
          @update:mode="m => emit('update:mode', m)" />
      </div>
      <div class="composer" :class="{ running }">
        <div class="composer-toolbar">
          <textarea
            ref="inputEl"
            v-model="draft"
            class="composer-input"
            placeholder="给校园小管家发送消息…"
            rows="1"
            @keydown.enter="onEnter"></textarea>
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
            <span v-if="running" class="send-stop-label">STOP</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
