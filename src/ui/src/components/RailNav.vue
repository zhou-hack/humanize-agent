<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  running: Boolean,
  newChatBusy: Boolean,
  chatRunning: Boolean,
  curationRunning: Boolean,
  activeNav: String
})
const emit = defineEmits(['chat', 'new-chat', 'history', 'event-curation', 'connection-settings', 'toggle-theme'])
const railEl = ref(null)
const indicatorStyle = ref({})

function moveIndicator() {
  nextTick(() => {
    const active = railEl.value?.querySelector('button.active')
    if (!active) return
    indicatorStyle.value = {
      transform: `translateY(${active.offsetTop + (active.offsetHeight - 24) / 2}px)`,
      height: '24px'
    }
  })
}

watch(() => props.activeNav, moveIndicator)
onMounted(() => {
  moveIndicator()
  window.addEventListener('resize', moveIndicator, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('resize', moveIndicator))
</script>

<template>
  <nav ref="railEl" class="rail" aria-label="校园小管家导航">
    <span class="rail-active-glow" :style="indicatorStyle" aria-hidden="true"></span>
    <button title="返回校园对话" :class="{ active: activeNav === 'chat' }" @click="emit('chat')">
      <span class="rail-index">01</span>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="rail-label">校园对话</span>
      <i v-if="chatRunning" class="rail-run-dot" title="校园对话正在运行"></i>
    </button>
    <button :title="newChatBusy ? '正在保存记忆并归档' : `新建${activeNav === 'curation' ? '策展' : ''}对话`" :disabled="running || newChatBusy" @click="emit('new-chat')">
      <span class="rail-index">02</span>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span class="rail-label">新对话</span>
    </button>
    <button title="历史对话（只读）" :class="{ active: activeNav === 'history' }" @click="emit('history')">
      <span class="rail-index">03</span>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
      <span class="rail-label">历史对话</span>
    </button>
    <button title="活动策展" :class="{ active: activeNav === 'curation' }" @click="emit('event-curation')">
      <span class="rail-index">04</span>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m12 13 1.2 2.3 2.6.4-1.9 1.8.5 2.5-2.4-1.2-2.3 1.2.4-2.5-1.8-1.8 2.6-.4Z"/></svg>
      <span class="rail-label">活动策展</span>
      <i v-if="curationRunning" class="rail-run-dot" title="活动策展正在运行"></i>
    </button>
    <span class="sp"></span>
    <button title="连接设置" :class="{ active: activeNav === 'connection-settings' }" @click="emit('connection-settings')">
      <span class="rail-index">05</span>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.55-1.03H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63h.01A1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9v.01A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>
      <span class="rail-label">连接设置</span>
    </button>
    <button class="theme-button" title="切换深浅色" @click="emit('toggle-theme', $event)">
      <span class="rail-index">06</span>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      <span class="rail-label">切换主题</span>
    </button>
  </nav>
</template>
