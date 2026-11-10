<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import TraceStep from './TraceStep.vue'

const props = defineProps({
  steps: { type: Array, required: true },
  status: { type: String, required: true },
  tokens: { type: Number, required: true },
  mode: { type: String, default: 'chat' }
})
const displaySteps = ref(props.steps.length)
const displayTokens = ref(props.tokens)
const animations = new Map()

function tween(key, target, current, update) {
  cancelAnimationFrame(animations.get(key))
  if (target === 0 || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update(target)
    return
  }
  const from = current()
  if (from === target) return
  const started = performance.now()
  function tick(now) {
    if (document.hidden) {
      update(target)
      return
    }
    const progress = Math.min((now - started) / 450, 1)
    update(Math.round(from + (target - from) * (1 - Math.pow(1 - progress, 3))))
    if (progress < 1) animations.set(key, requestAnimationFrame(tick))
    else animations.delete(key)
  }
  animations.set(key, requestAnimationFrame(tick))
}

watch(() => props.steps.length, target => tween('steps', target, () => displaySteps.value, value => { displaySteps.value = value }))
watch(() => props.tokens, target => tween('tokens', target, () => displayTokens.value, value => { displayTokens.value = value }))
watch(() => props.mode, () => {
  for (const frame of animations.values()) cancelAnimationFrame(frame)
  animations.clear()
  displaySteps.value = props.steps.length
  displayTokens.value = props.tokens
})

function finishAnimations() {
  if (!document.hidden) return
  for (const frame of animations.values()) cancelAnimationFrame(frame)
  animations.clear()
  displaySteps.value = props.steps.length
  displayTokens.value = props.tokens
}

document.addEventListener('visibilitychange', finishAnimations)
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', finishAnimations)
  for (const frame of animations.values()) cancelAnimationFrame(frame)
})
</script>

<template>
  <aside class="pane bench">
    <header class="head"><h1>[02] {{ mode === 'curation' ? 'CURATION TRACE' : 'TRACE' }}</h1></header>
    <div class="stat">
      <div class="stat-item"><span>STATUS</span><Transition name="status-flip" mode="out-in"><b :key="status">{{ status }}</b></Transition></div>
      <div class="stat-item"><span>STEPS</span><b :aria-label="String(steps.length)">{{ String(displaySteps).padStart(2, '0') }}</b></div>
      <div class="stat-item"><span>TOKENS</span><b :aria-label="String(tokens)">{{ displayTokens.toLocaleString('en-US') }}</b></div>
    </div>
    <div class="body">
      <div class="empty" v-if="!steps.length">当前{{ mode === 'curation' ? '策展' : '对话' }}还没有执行任何步骤</div>
      <TransitionGroup v-else name="step" tag="div" class="trace-track" :class="{ live: status === '执行中' }">
        <TraceStep v-for="(step, index) in steps" :key="step.id" :step="step" :style="{ '--step-index': Math.min(index, 6) }" />
      </TransitionGroup>
    </div>
  </aside>
</template>
