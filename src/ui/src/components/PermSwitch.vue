<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  mode: { type: String, default: 'workspace' },
  disabled: Boolean
})
const emit = defineEmits(['update:mode'])

const MODES = ['workspace', 'approval']
const LABELS = {
  workspace: '工作区：专用文件工具与只读白名单直接执行',
  approval: '审批模式：继承工作区能力，其他 shell 命令需要批准'
}
const thumbX = computed(() => Math.max(0, MODES.indexOf(props.mode)) * 34)
const swEl = ref(null)
const thumbEl = ref(null)
let drag = null

function setMode(next) {
  if (!props.disabled) emit('update:mode', next)
}

function onPointerDown(e) {
  if (props.disabled) return
  drag = { x0: e.clientX, id: e.pointerId, on: false, x: thumbX.value }
}

function onPointerMove(e) {
  if (!drag) return
  if (!drag.on) {
    if (Math.abs(e.clientX - drag.x0) < 4) return
    drag.on = true
    swEl.value?.setPointerCapture(drag.id)
    thumbEl.value?.classList.add('drag')
  }
  const rect = swEl.value.getBoundingClientRect()
  drag.x = Math.max(0, Math.min(34, e.clientX - rect.left - 2 - 17))
  thumbEl.value.style.transform = `translateX(${drag.x}px)`
  const index = Math.round(drag.x / 34)
  swEl.value.querySelectorAll('button').forEach((button, i) => {
    button.classList.toggle('on', i === index)
  })
}

function onPointerUp() {
  if (!drag) return
  const current = drag
  drag = null
  if (!current.on) return
  thumbEl.value?.classList.remove('drag')
  thumbEl.value.style.transform = ''
  setMode(MODES[Math.round(current.x / 34)])
}
</script>

<template>
  <div
    ref="swEl"
    class="sw"
    :data-m="mode"
    role="radiogroup"
    aria-label="权限模式"
    :aria-disabled="disabled"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp">
    <i ref="thumbEl" class="thumb" :style="{ transform: `translateX(${thumbX}px)` }"></i>
    <button
      v-for="m in MODES"
      :key="m"
      :data-m="m"
      :class="{ on: mode === m }"
      :title="LABELS[m]"
      :aria-label="LABELS[m]"
      :disabled="disabled"
      @click.stop="setMode(m)">
      <svg v-if="m === 'workspace'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5h6l2-2h9v13h-17z"/><path d="M3.5 10h17"/></svg>
      <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 7 3v5c0 4.4-2.8 7.4-7 9-4.2-1.6-7-4.6-7-9V6z"/><path d="M12 8.5v4.5"/><path d="M12 16.5h.01"/></svg>
    </button>
  </div>
</template>
