<script setup>
import { computed } from 'vue'
const props = defineProps({ msg: { type: Object, required: true } })
const emit = defineEmits(['decide'])
const tone = computed(() => props.msg.resolved === 'ok' ? 'ok' : props.msg.resolved === 'no' ? 'err' : 'wait')
const title = computed(() => {
  if (props.msg.resolved === 'ok') return '✓ APPROVED'
  if (props.msg.resolved === 'no') return '× REJECTED'
  return '! APPROVAL REQUIRED'
})
</script>

<template>
  <b :class="tone">{{ title }}</b>
  <span class="tag">执行命令</span>
  <span v-if="msg.risk === 'destructive'" class="tag" style="color:var(--err);border-color:var(--err)">高风险</span>
  <div class="lbl approval-command-label">run_command</div>
  <pre class="approval-command">{{ msg.command }}</pre>
  <div class="lbl">工作目录：{{ msg.cwd }}</div>
  <div class="row" v-if="!msg.resolved"><button class="primary" @click="emit('decide', true)">允许</button><button class="danger" @click="emit('decide', false)">拒绝</button></div>
</template>
