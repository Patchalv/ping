// Applies the saved colour theme before first paint, so the page never flashes the wrong
// one. A same-origin file because the CSP allows no inline script. Keep the storage key
// in step with src/lib/theme.ts.
(() => {
  let choice = 'system';
  try {
    choice = localStorage.getItem('ping-theme') || 'system';
  } catch {
    // Storage blocked: follow the system.
  }
  const dark =
    choice === 'dark' ||
    (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
