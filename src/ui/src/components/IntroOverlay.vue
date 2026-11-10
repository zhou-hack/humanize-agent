<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { gsap } from 'gsap'

const emit = defineEmits(['complete'])
const STORAGE_KEY = 'steward-intro-played'
const visible = ref(true)
const overlay = ref(null)
const counter = ref(0)
const chars = ['校', '园', '小', '管', '家']
let timeline
let finished = false

function finish(played = true) {
  if (finished) return
  finished = true
  try { sessionStorage.setItem(STORAGE_KEY, '1') } catch { /* 会话存储不可用时仅跳过本次 */ }
  document.removeEventListener('keydown', skip)
  visible.value = false
  emit('complete', played)
}

function skip() {
  timeline?.kill()
  counter.value = 100
  finish(true)
}

onMounted(() => {
  let played = false
  try { played = sessionStorage.getItem(STORAGE_KEY) === '1' } catch { /* 保持默认 */ }
  if (played) {
    visible.value = false
    emit('complete', false)
    return
  }
  document.addEventListener('keydown', skip)
  nextTick(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      counter.value = 100
      finish(true)
      return
    }
    const progress = { value: 0 }
    timeline = gsap.timeline({ onComplete: () => finish(true) })
    timeline
      .to(progress, {
        value: 100,
        duration: .9,
        ease: 'power2.out',
        onUpdate: () => { counter.value = Math.min(100, Math.floor(progress.value)) }
      }, 0)
      .to(overlay.value.querySelector('.intro-rule'), { scaleX: 1, duration: .9, ease: 'power2.inOut' }, 0)
      .to(overlay.value.querySelector('.intro-loading'), { opacity: 1, duration: .25 }, .08)
      .to(overlay.value.querySelectorAll('.intro-char'), { y: 0, duration: .45, stagger: .04, ease: 'power3.out' }, .9)
      .to(overlay.value.querySelector('.intro-steward'), { y: 0, opacity: 1, duration: .35, ease: 'power3.out' }, 1.08)
      .to(overlay.value, { clipPath: 'inset(0 0 100% 0)', duration: .5, ease: 'power2.inOut' }, 1.5)
  })
})

onBeforeUnmount(() => {
  timeline?.kill()
  document.removeEventListener('keydown', skip)
})
</script>

<template>
  <div v-if="visible" ref="overlay" class="intro-overlay" @click="skip">
    <div class="intro-rule" aria-hidden="true"></div>
    <div class="intro-brand" aria-label="校园小管家 Steward">
      <span class="intro-brand-cn"><span v-for="char in chars" :key="char" class="intro-char-mask"><span class="intro-char">{{ char }}</span></span></span>
      <span class="intro-steward">Steward.</span>
    </div>
    <div class="intro-counter">{{ String(counter).padStart(3, '0') }}</div>
    <div class="intro-loading">LOADING — 校园小管家 / CAMPUS AGENT</div>
    <div class="intro-skip">CLICK / ANY KEY TO SKIP</div>
  </div>
</template>
