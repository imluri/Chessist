export function applyTheme(accent = 'violet') {
  document.documentElement.dataset.theme = 'dark'
  document.documentElement.dataset.accent = accent
}
