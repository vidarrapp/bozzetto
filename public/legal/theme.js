// The legal pages' theme: ink or paper, as the app was last set (ui/theme.ts
// keeps the choice under this key). A file of its own, run before the page
// paints, because the site's Content-Security-Policy allows no inline script.
try {
  if (localStorage.getItem('bozzetto-theme') === 'light') document.documentElement.dataset.theme = 'light';
} catch (e) {
  // Storage unavailable: ink, the app's default.
}
