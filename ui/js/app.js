/* -----------------------------------------------------------------------------
 * ui/js/app.js — wires the buttons in the top bar + editor toolbar to the
 * API calls. Holds the current workspace metadata. Renders the Workspace
 * tab. Hosts the "Open project" dialog flow.
 * -------------------------------------------------------------------------- */

import { api }     from './api.js';
import { toast, showTab } from './ui.js';
import { treeBus, loadRoot } from './tree.js';
import { openFile, editorBus } from './editor.js';

const wsLabel    = document.getElementById('workspace-label');
const wsInfo     = document.getElementById('workspace-info');
const dlg        = document.getElementById('open-dialog');
const dlgInput   = document.getElementById('open-input');
const dlgForm    = document.getElementById('open-form');
const dropZone   = document.getElementById('drop-zone');
const winDropOv  = document.getElementById('window-drop-overlay');
const btnOpen    = document.getElementById('btn-open');
const btnRefresh = document.getElementById('btn-refresh');
const btnCollapse= document.getElementById('btn-collapse-all');
const editorBar  = document.querySelector('.editor-toolbar');

let workspace = null;

/* ── workspace open ──────────────────────────────────────────────────── */

btnOpen.addEventListener('click', () => openDialogWith(workspace ? workspace.root : ''));

function openDialogWith(prefill) {
  if (prefill) dlgInput.value = prefill;
  dlg.showModal();
  setTimeout(() => dlgInput.focus(), 30);
}

dlgForm.addEventListener('submit', async (e) => {
  /* dialog 'cancel' value also lands here; check which button. */
  const submitter = e.submitter && e.submitter.value;
  if (submitter === 'cancel') return;
  e.preventDefault();
  const path = dlgInput.value.trim();
  if (!path) return;
  try {
    const { workspace: ws } = await api.openWorkspace(path);
    workspace = ws;
    onWorkspaceOpened();
    dlg.close('ok');
  } catch (err) {
    toast('error', err.message);
  }
});

async function onWorkspaceOpened() {
  wsLabel.textContent = workspace.root;
  toast('success', `Opened ${workspace.frameworkLabel}`);
  renderWorkspace();
  await loadRoot();
  showTab('source');
}

/* ── drag-and-drop folder support ────────────────────────────────────── */

/** Pull an absolute filesystem path out of a DataTransfer.
 *  Browsers hide File.path for security, so the trick is to read the
 *  `text/uri-list` (or `text/plain`) entry that Windows / macOS / GNOME file
 *  managers populate with `file:///…` when you drag from them.
 *
 *  Returns one of:
 *    { path: '<absolute>' }            — full path detected, ready to submit
 *    { partialName: '<folder name>' }  — drop was a folder but only its name
 *                                        leaked through (e.g. Files API only)
 *    null                              — nothing useful
 */
function readDroppedPath(dt) {
  if (!dt) return null;

  /* 1. text/uri-list (RFC 2483) — Explorer, Finder, Nautilus all set this. */
  const uriList = (dt.getData('text/uri-list') || '')
    .split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  for (const uri of uriList) {
    if (/^file:\/\//i.test(uri)) {
      try {
        let p = decodeURIComponent(uri.replace(/^file:\/\/+/i, ''));
        /* file:///C:/Users/… → /C:/Users/… on Windows: drop leading slash. */
        if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
        return { path: p };
      } catch { /* malformed encoding, fall through */ }
    }
  }

  /* 2. text/plain — some file managers (and most "copy as path") leave the
   *    bare path here. Only accept it if it actually looks absolute. */
  const plain = (dt.getData('text/plain') || '').trim();
  if (plain && (/^[A-Za-z]:[\\/]/.test(plain) || plain.startsWith('/') || plain.startsWith('\\\\'))) {
    return { path: plain };
  }

  /* 3. Last resort: the File / FileSystemEntry API. This only gives us the
   *    leaf folder name — Chromium intentionally strips the absolute path.
   *    Surface that so the user can still complete the path manually. */
  for (const item of dt.items || []) {
    if (item.kind === 'file') {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) return { partialName: entry.name };
      if (entry?.isFile)      return { partialName: entry.name };
    }
  }
  return null;
}

/** True if the DataTransfer carries something that looks like an OS file/folder
 *  drag (as opposed to in-page text selection or HTML element drag). */
function isFileDrag(dt) {
  if (!dt) return false;
  const types = dt.types ? Array.from(dt.types) : [];
  return types.includes('Files') || types.includes('text/uri-list');
}

/** Wire a single element as a drop target. `onPath` receives the result of
 *  readDroppedPath (or null). */
function wireDropZone(el, onPath) {
  const enter = (e) => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('is-dragover');
  };
  el.addEventListener('dragenter', enter);
  el.addEventListener('dragover',  enter);
  el.addEventListener('dragleave', (e) => {
    /* Ignore bubbled leaves from children. */
    if (el.contains(e.relatedTarget)) return;
    el.classList.remove('is-dragover');
  });
  el.addEventListener('drop', (e) => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    el.classList.remove('is-dragover');
    onPath(readDroppedPath(e.dataTransfer));
  });
}

/* a) drops into the dialog input area fill the input (and optionally submit) */
wireDropZone(dropZone, (res) => {
  if (!res) {
    toast('warning', 'Could not read a path from that drop — paste it instead.');
    dlgInput.focus();
    return;
  }
  if (res.path) {
    dlgInput.value = res.path;
    dlgInput.focus();
    /* Auto-submit since the user clearly wants to open this folder. */
    dlgForm.requestSubmit(dlgForm.querySelector('button[value="ok"]'));
  } else if (res.partialName) {
    dlgInput.value = res.partialName;
    dlgInput.focus();
    toast('info', 'Browser hid the full path — please complete it before clicking Open.');
  }
});

/* b) full-window drop: any folder dropped anywhere on the page opens it
 *    directly. Avoid hijacking when the open-dialog is already showing one
 *    of its own drop targets (it owns the gesture). */
let winDragDepth = 0;        /* dragenter/leave fire per child — refcount */

function shouldOwnDrop(target) {
  /* Defer to the dialog's own drop-zone if the gesture is over the dialog. */
  return !dropZone.contains(target);
}

window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e.dataTransfer) || !shouldOwnDrop(e.target)) return;
  winDragDepth++;
  if (winDragDepth === 1) winDropOv.classList.add('is-active');
});
window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e.dataTransfer) || !shouldOwnDrop(e.target)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e.dataTransfer)) return;
  winDragDepth = Math.max(0, winDragDepth - 1);
  if (winDragDepth === 0) winDropOv.classList.remove('is-active');
});
window.addEventListener('drop', async (e) => {
  if (!isFileDrag(e.dataTransfer)) return;
  winDragDepth = 0;
  winDropOv.classList.remove('is-active');
  if (!shouldOwnDrop(e.target)) return;        /* dialog handled it */
  e.preventDefault();
  const res = readDroppedPath(e.dataTransfer);
  if (!res) { toast('warning', 'Could not read a path from that drop.'); return; }
  if (res.path) {
    try {
      const { workspace: ws } = await api.openWorkspace(res.path);
      workspace = ws;
      await onWorkspaceOpened();
    } catch (err) { toast('error', err.message); }
  } else if (res.partialName) {
    /* Only got the folder name — pop the dialog so the user can complete it. */
    openDialogWith(res.partialName);
    toast('info', 'Browser hid the full path — please complete it before clicking Open.');
  }
});

btnRefresh.addEventListener('click', async () => {
  if (!workspace) { toast('info', 'open a project first'); return; }
  try {
    const { workspace: ws } = await api.openWorkspace(workspace.root);
    workspace = ws;
    renderWorkspace();
    await loadRoot();
    toast('success', 'refreshed');
  } catch (e) { toast('error', e.message); }
});

btnCollapse.addEventListener('click', () => treeBus.collapseAll());

/* ── auto-open file when a tree row is clicked ───────────────────────── */

treeBus.onSelect((entry) => {
  if (!entry) return;
  if (entry.kind === 'file') openFile(entry.path);
});

/* ── run buttons (delegated) ─────────────────────────────────────────── */

editorBar.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-run]');
  if (!btn) return;
  if (!workspace) { toast('info', 'open a project first'); return; }
  const tool = btn.dataset.run;
  /* Target precedence:
   *   1. currently-selected tree entry
   *   2. currently-open file in editor
   *   3. workspace root */
  const sel = treeBus.selected();
  const target = sel?.path || editorBus.currentPath() || workspace.root;
  try {
    await api.run(tool, target);
    showTab('log');
    toast('info', `${tool} → ${shortPath(target)}`);
  } catch (err) {
    toast('error', err.message);
  }
});

/* ── workspace tab content ───────────────────────────────────────────── */

function renderWorkspace() {
  if (!workspace) {
    wsInfo.innerHTML = `<p class="empty-state">Open a project to see workspace info.</p>`;
    return;
  }
  const c = workspace.composer || {};
  const sourceLabel = {
    vendor:      'project vendor',
    bundled:     'bundled with Probatur',
    system:      'system PATH',
    'php-builtin': 'php built-in',
    missing:     'missing',
  };
  const toolCards = Object.entries(workspace.tools).map(([id, t]) => {
    const ok = t.source !== 'missing';
    const detail = ok ? t.command : (t.hint || '(missing)');
    return `
      <div class="tool-card ${ok ? 'is-ok' : 'is-missing'}">
        <div class="tname">
          <span>${escapeHtml(t.name)} ${ok ? '✓' : '○'}</span>
          <span class="src-badge src-${t.source}">${escapeHtml(sourceLabel[t.source] || t.source)}</span>
        </div>
        <div class="tcmd" title="${escapeHtml(detail)}">${escapeHtml(detail)}</div>
      </div>
    `;
  }).join('');
  wsInfo.innerHTML = `
    <h3>${escapeHtml(workspace.frameworkLabel)}</h3>
    <dl class="kv">
      <dt>Root</dt><dd>${escapeHtml(workspace.root)}</dd>
      <dt>Framework</dt><dd>${escapeHtml(workspace.framework)}</dd>
      <dt>PHP requirement</dt><dd>${escapeHtml(c.phpRequirement || '—')}</dd>
      <dt>PHP files</dt><dd>${workspace.stats.phpFiles.toLocaleString()}</dd>
      <dt>Test files</dt><dd>${workspace.stats.tests.toLocaleString()}</dd>
      <dt>Lines of PHP</dt><dd>${workspace.stats.lines.toLocaleString()}</dd>
      <dt>Test directories</dt><dd>${escapeHtml(workspace.testDirs.join(', ') || '—')}</dd>
      <dt>composer.json</dt><dd>${c.exists ? '✓ present' : '— missing'}</dd>
    </dl>
    <h3 style="margin-top:18px">Detected tools</h3>
    <div class="tools-grid">${toolCards}</div>
    <p class="hint" style="margin-top:18px">
      Probatur is read-only. It spawns your project's own copies of these tools — nothing on disk is modified.
    </p>
  `;
}

/* ── boot — try to re-open the last workspace if any ─────────────────── */
(async () => {
  try {
    const ws = await api.workspace();
    workspace = ws;
    await onWorkspaceOpened();
  } catch {
    /* No workspace yet — that's fine, user will click Open. */
  }
})();

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function shortPath(p) {
  const segs = String(p).split(/[\\/]/);
  return segs.slice(-3).join('/');
}
