/* -----------------------------------------------------------------------------
 * ui/js/tree.js — lazy file-explorer tree. Each directory expands on click
 * via /api/tree?path=.... Selecting a node fires `treeBus.onSelect(entry)`.
 * Right-click selects (no actual context menu yet) so test buttons in the
 * editor toolbar always know what to operate on.
 * -------------------------------------------------------------------------- */

import { api } from './api.js';

const root = document.getElementById('tree');
let selectedEntry = null;
const listeners = new Set();

export const treeBus = {
  selected:  () => selectedEntry,
  onSelect:  (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  reload:    () => loadInto(root, null, null),
  collapseAll: () => root.querySelectorAll('.tree-children').forEach((el) => el.remove()),
};

function emit() {
  for (const fn of listeners) try { fn(selectedEntry); } catch (e) { console.error(e); }
}

function iconFor(entry) {
  if (entry.kind === 'dir') return '📁';
  switch (entry.role) {
    case 'composer':         return '🎼';
    case 'env':              return '🔑';
    case 'phpunit-config':   return '🧪';
    case 'phpstan-config':   return '🔍';
    case 'psalm-config':     return '🔎';
    case 'laravel-cli':      return '🚀';
    case 'codeigniter-cli':  return '🔥';
    case 'test':             return '🧪';
    case 'controller':       return '🎮';
    case 'model':            return '📦';
    case 'service':          return '⚙';
    case 'php':              return '🐘';
    case 'blade':            return '🌿';
    case 'twig':             return '🌿';
    case 'json':             return '📋';
    case 'yaml':             return '📃';
    case 'markdown':         return '📖';
    case 'sql':              return '🗄';
    default:                 return '📄';
  }
}

async function loadInto(container, parentPath, parentDirEl) {
  let resp;
  try { resp = await api.tree(parentPath || ''); }
  catch (e) {
    container.innerHTML = `<div class="tree-empty">load failed: ${escapeHtml(e.message)}</div>`;
    return;
  }
  container.innerHTML = '';
  for (const entry of resp.entries) {
    const row = document.createElement('div');
    row.className = 'tree-row' + (entry.hidden ? ' is-hidden' : '');
    row.dataset.path = entry.path;
    row.dataset.kind = entry.kind;
    row.innerHTML = `
      <span class="tree-twig">${entry.kind === 'dir' ? '▸' : ' '}</span>
      <span class="tree-icon">${iconFor(entry)}</span>
      <span class="tree-name">${escapeHtml(entry.name)}</span>
    `;
    row.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      /* Update selection visual + fire bus. */
      document.querySelectorAll('.tree-row.is-selected').forEach((el) => el.classList.remove('is-selected'));
      row.classList.add('is-selected');
      selectedEntry = entry;
      emit();
      /* If directory: toggle expand/collapse. */
      if (entry.kind === 'dir') {
        const existing = row.nextElementSibling?.classList.contains('tree-children')
          ? row.nextElementSibling : null;
        if (existing) {
          existing.remove();
          row.querySelector('.tree-twig').textContent = '▸';
        } else {
          const childBox = document.createElement('div');
          childBox.className = 'tree-children';
          row.querySelector('.tree-twig').textContent = '▾';
          row.after(childBox);
          childBox.innerHTML = `<div class="tree-empty">…loading</div>`;
          await loadInto(childBox, entry.path, row);
        }
      }
    });
    container.appendChild(row);
  }
  if (!resp.entries.length) {
    container.innerHTML = '<div class="tree-empty">(empty)</div>';
  }
}

/* The top-level load is kicked off by app.js after a workspace opens. */
export async function loadRoot() {
  root.innerHTML = '<div class="tree-empty">…loading project</div>';
  selectedEntry = null;
  await loadInto(root, null, null);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
