<script setup>
import { computed } from 'vue'

const props = defineProps({ msg: { type: Object, required: true } })
const emit = defineEmits(['decide'])

const tone = computed(() => props.msg.resolved === 'ok' ? 'ok' : props.msg.resolved === 'no' ? 'err' : 'wait')
const title = computed(() => {
  if (props.msg.resolved === 'ok') return '已允许'
  if (props.msg.resolved === 'no') return '已拒绝'
  return '需要你的批准'
})
</script>

<template>
  <b :class="tone">{{ title }}</b>
  <span class="tag">执行命令</span>
  <span v-if="msg.risk === 'destructive'" class="tag" style="color:var(--err);border-color:var(--err)">高风险</span>
  <div class="lbl" style="padding:6px 0 4px">run_command</div>
  <pre style="border:1px solid var(--line);border-radius:6px">{{ msg.command }}</pre>
  <div class="lbl">工作目录：{{ msg.cwd }}</div>
  <div class="row" v-if="!msg.resolved" style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
    <button class="primary" @click="emit('decide', true)">允许</button>
    <button class="danger" @click="emit('decide', false)">拒绝</button>
  </div>
</template>
