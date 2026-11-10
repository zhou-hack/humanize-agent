<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import MessageItem from './MessageItem.vue'
import PermSwitch from './PermSwitch.vue'
import EffortSlider from './EffortSlider.vue'

const props = defineProps({
  msgs: { type: Array, required: true },
  running: Boolean,
  status: { type: String, default: '待命' },
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
const localPhase = computed(() => {
  if (props.status === '等待确认') return '等待你处理审批'
  if (props.running) return 'Agent 正在处理，以下为真实流式回复'
  if (props.msgs.length) return '可继续补充信息或确认方向'
  return '本地引导，尚未发送给 Agent'
})
const waitingText = computed(() => props.status === '等待确认'
  ? 'Agent 正在等待你的审批，处理后将继续。'
  : '已收到你的原文，Agent 正在按策展流程整理内容，请稍候…')

watch(draft, () => nextTick(resizeInput))
watch(() => props.msgs, () => {
  nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}, { deep: true })

function resizeInput() {
  const el = inputEl.value
  if (!el) return
  el.style.height = '24px'
  el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  el.style.overflowY = el.scrollHeight > 96 ? 'auto' : 'hidden'
}

function send() {
  const text = draft.value.trim()
  if (!text || props.running || props.newChatBusy) return
  emit('send', text)
  draft.value = ''
}

function onEnter(event) {
  if (event.shiftKey || event.isComposing) return
  event.preventDefault()
  send()
}

function isLastOfGroup(index) {
  const current = props.msgs[index]
  if (!current || (current.kind !== 'user' && current.kind !== 'agent')) return false
  const next = props.msgs[index + 1]
  return !next || next.kind !== current.kind
}
</script>

<template>
  <section class="pane curation-pane">
    <header class="head">
      <span class="dot" :class="{ run: running }" aria-hidden="true"></span>
      <h1><span class="head-section">[04]</span>活动策展 <em>Curate.</em></h1>
      <span class="head-meta">{{ running ? '● CURATING' : '○ STANDBY' }}</span>
      <span class="head-meta">MODEL · {{ modelName || 'CONNECTING…' }}</span>
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
      <section v-if="!msgs.length" class="event-curation-intro" aria-label="活动策展本地引导">
        <div class="empty-kicker">CAMPUS EVENT CURATION — FROM IDEA TO PLAN</div>
        <h2>把灵感，变成<br>一场好活动<i>.</i></h2>
        <p class="curation-lead">说说你想办的活动。下方四问只是本地快速引导，不会冒充 Agent 回复；发送后由 Agent 按真实策展流程继续。</p>
        <div class="event-curation-card">
          <div class="curation-card-label">快速描述 · 能答几个答几个</div>
          <ol class="event-curation-questions">
            <li><strong>活动是什么主题？</strong><span>迎新、社团招新、校园市集、晚会、分享会，或你的主题名称。</span></li>
            <li><strong>给谁看、为什么办？</strong><span>面向新同学、全院还是社团内部？希望招新、展示、纯玩还是拉赞助？</span></li>
            <li><strong>在哪办、哪天办？</strong><span>食堂门口、小广场或活动中心？室内还是室外，哪个时段？</span></li>
            <li><strong>想让人走时带走什么？</strong><span>想加入社团、一张照片、一段体验，或一件亲手做的小东西？</span></li>
          </ol>
          <p>也可补充组织与人手、预算及出资方。未说明的信息由 Agent 按 Skill 流程询问或标注默认值；说「别问了直接给」即可走快速通道。</p>
        </div>
      </section>

      <TransitionGroup name="msg">
        <MessageItem
          v-for="(message, index) in msgs"
          :key="message.id"
          :msg="message"
          :is-last="isLastOfGroup(index)"
          @decide="(id, approved) => emit('decide', id, approved)" />
      </TransitionGroup>

      <div v-if="running" class="curation-waiting" role="status">
        <span class="curation-waiting-spinner" aria-hidden="true"></span>
        <div><strong>{{ status === '等待确认' ? '等待你的审批' : '正在生成活动方案' }}</strong><span>{{ waitingText }}</span></div>
      </div>
    </div>

    <div class="curation-local-state"><span>LOCAL STATUS</span>{{ localPhase }}</div>
    <div class="composer-area">
      <div class="composer-permission">
        <PermSwitch
          :mode="mode"
          :disabled="settingsBusy || newChatBusy || modeBusy"
          @update:mode="value => emit('update:mode', value)" />
      </div>
      <div class="composer" :class="{ running }">
        <div class="composer-toolbar">
          <textarea
            ref="inputEl"
            v-model="draft"
            class="composer-input"
            placeholder="描述活动想法，或回答 Agent 的策展问题…"
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
            :title="running ? '中止活动策展' : '发送活动想法'"
            :aria-label="running ? '中止活动策展' : '发送活动想法'"
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
