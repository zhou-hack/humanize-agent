<script setup>
import { computed, ref } from 'vue'
import { getToolLabel, getToolSummary } from '../toolLabels'

const props = defineProps({ step: { type: Object, required: true } })
const LABEL = { running: '执行中', ok: '成功', err: '失败', wait: '等待' }
const open = ref(false)
const label = computed(() => LABEL[props.step.status])
const args = computed(() => JSON.stringify(props.step.args, null, 2))
const tool = computed(() => getToolLabel(props.step.name))
const summary = computed(() => getToolSummary(props.step.args))
const memoryContent = computed(() => props.step.name === 'remember' && typeof props.step.args?.content === 'string' ? props.step.args.content : '')
const durationLabel = computed(() => props.step.duration ? `${(props.step.duration / 1000).toFixed(2)}s` : '')
</script>

<template>
  <article class="step" :class="[`status-${step.status}`, { open, pulse: step.status === 'wait', memory: step.name === 'remember' }]">
    <span class="step-node" aria-hidden="true">
      <svg v-if="step.status === 'ok'" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg>
      <b v-else-if="step.status === 'err'">×</b><b v-else-if="step.status === 'wait'">!</b><i v-else></i>
    </span>
    <button class="step-head" @click="open = !open">
      <span class="step-title"><span class="step-title-line"><span>{{ tool.icon }}</span><strong>{{ step.name }}</strong><span class="step-summary">{{ summary || tool.label }}</span></span></span>
      <span class="badge" :class="step.status">{{ label }}</span><span class="dur">{{ durationLabel }}</span><span class="chev">›</span>
    </button>
    <div v-if="memoryContent" class="memory-content">{{ memoryContent }}</div>
    <div class="step-body"><div><div class="lbl">输入</div><pre>{{ args }}</pre><template v-if="step.output"><div class="lbl">输出</div><pre>{{ step.output }}</pre></template></div></div>
  </article>
</template>
