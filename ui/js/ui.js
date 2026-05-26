/* -----------------------------------------------------------------------------
 * ui/js/ui.js — toast, tabs, theme toggle.
 * No framework — just direct DOM manipulation.
 * -------------------------------------------------------------------------- */

const toastBox = document.getElementById('toast-container');

export function toast(kind, text, ms = 3000) {
  const t = document.createElement('div');
  t.className = `toast t-${kind}`;
  t.textContent = text;
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* Tabs — driven by [data-tab] buttons + [data-panel] containers. */
const tabbar = document.getElementById('tabbar');
const panels = document.querySelectorAll('[data-panel]');
tabbar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  showTab(b.dataset.tab);
});
export function showTab(key) {
  for (const btn of tabbar.querySelectorAll('[data-tab]')) {
    btn.classList.toggle('is-active', btn.dataset.tab === key);
  }
  for (const p of panels) {
    p.classList.toggle('is-active', p.dataset.panel === key);
  }
}

/* Theme — persist to localStorage. */
const themeBtn = document.getElementById('btn-theme');
function applyTheme(name) {
  if (name === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else                  document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('probatur-theme', name); } catch {}
}
themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'light' ? 'dark' : 'light');
});
try { applyTheme(localStorage.getItem('probatur-theme') || 'dark'); } catch {}
