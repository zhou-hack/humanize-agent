let currentTransition
let requestedTheme = null
const iconAnimations = new WeakMap()

export function useTheme() {
  async function toggleTheme(event) {
    const root = document.documentElement
    const current = requestedTheme ?? root.dataset.theme
      ?? (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')
    const next = current === 'dark' ? 'light' : 'dark'
    requestedTheme = next
    const applyTheme = () => { root.dataset.theme = next }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const button = event?.currentTarget
    try { currentTransition?.skipTransition() } catch { /* 已完成的过渡无需衔接 */ }

    if (reduced) {
      iconAnimations.get(button?.querySelector('svg'))?.cancel()
      applyTheme()
      requestedTheme = null
      return
    }

    rotateIcon(button)
    if (!document.startViewTransition) {
      applyTheme()
      requestedTheme = null
      return
    }

    const rect = button?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const transition = document.startViewTransition(applyTheme)
    currentTransition = transition

    try {
      await transition.ready
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 520,
          easing: 'cubic-bezier(.76, 0, .24, 1)',
          pseudoElement: '::view-transition-new(root)'
        }
      )
      await transition.finished
    } catch {
      // 连续点击或页面切换中断过渡时，仍保留最新主题。
    } finally {
      if (currentTransition === transition) {
        currentTransition = null
        requestedTheme = null
      }
    }
  }

  return { toggleTheme }
}

function rotateIcon(button) {
  const icon = button?.querySelector('svg')
  if (!icon) return
  let start = 0
  const transform = getComputedStyle(icon).transform
  if (transform && transform !== 'none') {
    const values = transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number)
    if (values?.length === 6) start = Math.atan2(values[1], values[0]) * 180 / Math.PI
  }
  iconAnimations.get(icon)?.cancel()
  const animation = icon.animate(
    [{ transform: `rotate(${start}deg)` }, { transform: `rotate(${start + 180}deg)` }],
    { duration: 520, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' }
  )
  iconAnimations.set(icon, animation)
}
