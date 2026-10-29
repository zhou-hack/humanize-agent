<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ step: { type: Object, required: true } })

const LABEL = { running: '执行中', ok: '成功', err: '失败', wait: '等待' }

const open = ref(false)
const label = computed(() => LABEL[props.step.status])
const args = computed(() => JSON.stringify(props.step.args, null, 2))
</script>

<template>
  <article class="step" :class="{ open, pulse: step.status === 'wait' }">
    <button class="step-head" @click="open = !open">
      <span class="badge" :class="step.status">{{ label }}</span>
      <span class="name">{{ step.name }}</span>
      <span class="dur">{{ step.duration ? step.duration + ' ms' : '' }}</span>
      <span class="chev">›</span>
    </button>
    <div class="step-body">
      <div>
        <div class="lbl">输入</div>
        <pre>{{ args }}</pre>
        <template v-if="step.output">
          <div class="lbl">输出</div>
          <pre>{{ step.output }}</pre>
        </template>
      </div>
    </div>
  </article>
</template>
