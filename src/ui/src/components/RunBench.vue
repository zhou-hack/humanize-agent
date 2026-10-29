<script setup>
import TraceStep from './TraceStep.vue'

defineProps({
  steps: { type: Array, required: true },
  status: { type: String, required: true },
  tokens: { type: Number, required: true }
})
</script>

<template>
  <aside class="pane bench">
    <header class="head">
      <h1>执行轨迹</h1>
    </header>

    <div class="stat">
      <span>状态 <b>{{ status }}</b></span>
      <span>步骤 <b>{{ steps.length }}</b></span>
      <span>用量 <b>{{ tokens }}</b> tokens</span>
    </div>

    <div class="body">
      <div class="empty" v-if="!steps.length">还没有执行任何步骤</div>
      <TransitionGroup name="step">
        <TraceStep v-for="s in steps" :key="s.id" :step="s" />
      </TransitionGroup>
    </div>
  </aside>
</template>
