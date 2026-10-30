<script setup>
import { computed, ref, watch } from 'vue'
import ApprovalCard from './ApprovalCard.vue'
import { renderMarkdown } from '../markdown'

const props = defineProps({
  msg: { type: Object, required: true },
  isLast: { type: Boolean, default: false }
})
const emit = defineEmits(['decide'])
const copied = ref(false)
const agentHtml = computed(() => renderMarkdown(props.msg.text))
const thinkOpen = ref(Boolean(props.msg.streaming))
watch(() => props.msg.streaming, (streaming) => { thinkOpen.value = Boolean(streaming) })

const rootClass = computed(() => {
  const base = {
    user: 'msg user',
    agent: 'msg agent',
    chip: 'inline-step',
    thinking: 'msg-think',
    approval: 'aw' + (props.msg.resolved ? ' done' : ''),
    system: 'msg-sys'
  }[props.msg.kind] ?? 'msg-sys'
  return base + (props.isLast && (props.msg.kind === 'user' || props.msg.kind === 'agent') ? ' last' : '')
})

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  })
}
</script>

<template>
  <div :class="rootClass">
    <template v-if="msg.kind === 'user'">
      <div class="msg-bubble">{{ msg.text }}</div>
    </template>

    <template v-else-if="msg.kind === 'agent'">
      <div class="msg-bubble">
        <div class="markdown" v-html="agentHtml"></div>
        <button class="msg-copy" title="复制" @click="copyText(msg.text)">
          <svg v-if="!copied" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--ok)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
    </template>

    <template v-else-if="msg.kind === 'chip'">{{ msg.text }}</template>

    <details v-else-if="msg.kind === 'thinking'" :open="thinkOpen" @toggle="thinkOpen = $event.target.open">
      <summary>{{ msg.streaming ? '思考中…' : '思考过程' }}</summary>
      <div class="think-body">{{ msg.text }}</div>
    </details>

    <ApprovalCard
      v-else-if="msg.kind === 'approval'"
      :msg="msg"
      @decide="approved => emit('decide', msg.callId, approved)" />

    <template v-else>{{ msg.text }}</template>
  </div>
</template>
