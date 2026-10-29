import { ref } from 'vue'

export function useToast(duration = 1800) {
  const text = ref('')
  let timer = null

  function show(message) {
    text.value = message
    clearTimeout(timer)
    timer = setTimeout(() => { text.value = '' }, duration)
  }

  return { text, show }
}
