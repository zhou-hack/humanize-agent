export function useTheme() {
  function toggleTheme() {
    const root = document.documentElement
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme:dark)').matches
    root.dataset.theme = dark ? 'light' : 'dark'
  }

  return { toggleTheme }
}
