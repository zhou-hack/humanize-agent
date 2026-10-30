<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  effort: { type: String, default: 'high' },
  disabled: Boolean,
  modelName: { type: String, default: '' }
})
const emit = defineEmits(['update:effort'])

const LEVELS = [
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
  { id: 'xhigh', label: '极高' },
  { id: 'max', label: 'Max', fx: 'max' },
  { id: 'ultra', label: 'Ultra', fx: 'ultra' }
]
const THEMES = {
  normal: { c1: '#1f78ff', c2: '#2b86ff', c3: '#3a94ff', accent: '#3d9bff' },
  max: { c1: 'hsl(232 62% 46%)', c2: 'hsl(262 60% 56%)', c3: 'hsl(278 62% 72%)', accent: '#a47cff' },
  ultra: { c1: 'hsl(228 70% 44%)', c2: 'hsl(268 72% 58%)', c3: 'hsl(290 78% 78%)', accent: '#b98cff' }
}
const LAST = LEVELS.length - 1
const DEFAULT = 2

const open = ref(false)
const dragging = ref(false)
const position = ref(indexOf(props.effort) / LAST)
const sliderEl = ref(null)
const trackEl = ref(null)
const pillEl = ref(null)
const popEl = ref(null)
const starsWidth = ref(0)
let observer

const currentIndex = computed(() => Math.round(position.value * LAST))
const currentLevel = computed(() => LEVELS[currentIndex.value])
const controlStyle = computed(() => ({
  '--p': position.value,
  ...Object.fromEntries(Object.entries(THEMES[currentLevel.value.fx || 'normal']).map(([key, value]) => [`--${key}`, value]))
}))
const stars = Array.from({ length: 42 }, (_, index) => {
  const size = 1 + Math.random() * 2.2
  return {
    id: index,
    extra: index % 2 === 1,
    style: {
      left: `${Math.random() * 100}%`,
      top: `${10 + Math.random() * 80}%`,
      width: `${size}px`,
      height: `${size}px`,
      '--d': `${1.6 + Math.random() * 2.4}s`,
      '--delay': `${-Math.random() * 4}s`
    }
  }
})

watch(() => props.effort, (value) => {
  if (!dragging.value) position.value = indexOf(value) / LAST
})
watch(() => props.disabled, (disabled) => {
  if (disabled) setOpen(false)
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeyDown)
  if (trackEl.value) starsWidth.value = trackEl.value.clientWidth
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      if (trackEl.value) starsWidth.value = trackEl.value.clientWidth
    })
    if (trackEl.value) observer.observe(trackEl.value)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeyDown)
  observer?.disconnect()
})

function indexOf(effort) {
  const index = LEVELS.findIndex(level => level.id === effort)
  return index === -1 ? DEFAULT : index
}

function setPosition(next, animate = false) {
  position.value = Math.min(1, Math.max(0, next))
  sliderEl.value?.classList.toggle('anim', animate)
  const level = LEVELS[Math.round(position.value * LAST)]
  if (level.id !== props.effort) emit('update:effort', level.id)
}

function positionFromEvent(event) {
  const rect = sliderEl.value.getBoundingClientRect()
  const thumb = parseFloat(getComputedStyle(sliderEl.value).getPropertyValue('--thumb'))
  return (event.clientX - rect.left - thumb / 2) / (rect.width - thumb)
}

function onPointerDown(event) {
  if (props.disabled) return
  dragging.value = true
  sliderEl.value.setPointerCapture(event.pointerId)
  sliderEl.value.classList.add('dragging')
  setPosition(positionFromEvent(event), true)
}

function onPointerMove(event) {
  if (dragging.value) setPosition(positionFromEvent(event))
}

function endDrag() {
  if (!dragging.value) return
  dragging.value = false
  sliderEl.value?.classList.remove('dragging')
  setPosition(Math.round(position.value * LAST) / LAST, true)
}

function onSliderKeyDown(event) {
  const offsets = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }
  let index = currentIndex.value
  if (event.key in offsets) index += offsets[event.key]
  else if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = LAST
  else return
  event.preventDefault()
  setPosition(Math.min(LAST, Math.max(0, index)) / LAST, true)
}

function reset() {
  setPosition(DEFAULT / LAST, true)
  sliderEl.value?.focus({ preventScroll: true })
}

function setOpen(next) {
  open.value = next
  if (next) nextTick(() => sliderEl.value?.focus({ preventScroll: true }))
}

function onDocumentPointerDown(event) {
  if (!popEl.value?.contains(event.target) && !pillEl.value?.contains(event.target)) setOpen(false)
}

function onDocumentKeyDown(event) {
  if (event.key === 'Escape' && open.value) {
    setOpen(false)
    pillEl.value?.focus()
  }
}
</script>

<template>
  <div class="effort-control" :style="controlStyle">
    <div
      ref="popEl"
      class="effort-pop"
      :class="{ open }"
      role="dialog"
      aria-label="推理强度"
      :aria-hidden="!open"
      :inert="!open">
      <button class="effort-reset" type="button" aria-label="恢复默认" title="恢复默认" :disabled="disabled || currentIndex === DEFAULT" @click="reset">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>
      </button>
      <div class="effort-head">
        <div class="effort-level">{{ currentLevel.label }}</div>
        <div v-if="modelName" class="effort-model">{{ modelName }}</div>
      </div>
      <div
        ref="sliderEl"
        class="effort-slider"
        :class="{ galaxy: currentLevel.fx, ultra: currentLevel.fx === 'ultra' }"
        role="slider"
        :tabindex="disabled ? -1 : 0"
        aria-label="推理强度"
        aria-valuemin="0"
        :aria-valuemax="LAST"
        :aria-valuenow="currentIndex"
        :aria-valuetext="currentLevel.label"
        :aria-disabled="disabled"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @keydown="onSliderKeyDown">
        <div ref="trackEl" class="effort-track">
          <div class="effort-fill">
            <div class="effort-stars" :style="{ width: `${starsWidth}px` }">
              <i v-for="star in stars" :key="star.id" class="effort-star" :class="{ extra: star.extra }" :style="star.style"></i>
            </div>
          </div>
          <div class="effort-dots">
            <i
              v-for="(level, index) in LEVELS"
              :key="level.id"
              class="effort-dot"
              :class="{ on: index < currentIndex }"
              :style="{ '--k': index / LAST }"></i>
          </div>
        </div>
        <div class="effort-thumb"></div>
      </div>
    </div>

    <button
      ref="pillEl"
      class="effort-pill"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :disabled="disabled"
      @click.stop="setOpen(!open)">
      推理强度 <span class="effort-pill-level">{{ currentLevel.label }}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
    </button>
  </div>
</template>
