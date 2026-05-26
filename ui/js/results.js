/* -----------------------------------------------------------------------------
 * ui/js/results.js — accumulates Issue events from the WebSocket bus,
 * renders them in the Issues tab, updates the badge count, and clicks
 * through to the editor.
 * -------------------------------------------------------------------------- */

import { bus } from './ws.js';
import { openFile, setMarkers, gotoLine } from './editor.js';

const listEl  = document.getElementById('issues-list');
const badgeEl = document.getElementById('issue-badge');
const logEl   = document.getElementById('log');
const jobLabel= document.getElementById('job-label');
const jobsEl  = document.getElementById('jobs');
const clearLog= document.getElementById('btn-clear-log');

let currentJob = null;            /* id of the job whose output we're showing */
let issues     = [];              /* in-order issue list */
const jobs     = new Map();       /* id → metadata for the side panel */

clearLog.addEventListener('click', () => { logEl.textContent = ''; });

bus.on('started', (m) => {
  currentJob = m.jobId;
  issues = [];
  setMarkers('', []);
  jobLabel.textContent = `${m.job.toolName} · ${shortPath(m.job.target)} · running`;
  logEl.textContent = '';
  upsertJob(m.job);
  renderIssues();
});

bus.on('log', (m) => {
  if (m.jobId !== currentJob) return;
  const cls = m.stream === 'stderr' ? 'stderr' : m.stream === 'meta' ? 'meta' : '';
  appendLog(m.text, cls);
});

bus.on('issue', (m) => {
  if (m.jobId !== currentJob) return;
  issues.push(m.issue);
  renderIssues();
  /* If the issue belongs to the currently open file, repaint markers. */
  setMarkers(m.issue.file, issues.filter((i) => i.file === m.issue.file));
});

bus.on('done', (m) => {
  if (m.jobId === currentJob) {
    jobLabel.textContent = `${m.job.toolName} · exit=${m.job.exitCode} · ${m.job.passed ? 'passed ✓' : 'failed ✗'}`;
    appendLog(`\n--- done ---\n`, 'meta');
  }
  upsertJob(m.job);
});

bus.on('snapshot', (m) => upsertJob(m.job));

/* ── render helpers ───────────────────────────────────────────────────── */

function renderIssues() {
  if (!issues.length) {
    listEl.innerHTML = `<p class="empty-state">No issues reported.</p>`;
    badgeEl.classList.add('hidden');
    return;
  }
  const counts = { error: 0, fail: 0, warning: 0, info: 0, pass: 0 };
  for (const i of issues) counts[i.severity] = (counts[i.severity] || 0) + 1;
  badgeEl.classList.remove('hidden');
  badgeEl.textContent = String(counts.error + counts.fail + counts.warning);
  listEl.innerHTML = issues.map((i, idx) => {
    const icon = ({ error: '✖', fail: '✖', warning: '⚠', info: 'ℹ', pass: '✓' })[i.severity] || '·';
    const loc  = i.file ? `${shortPath(i.file)}${i.line ? ':' + i.line : ''}` : '';
    return `
      <div class="issue s-${i.severity}" data-idx="${idx}">
        <span class="sev">${icon}</span>
        <div>
          <div class="msg">${escapeHtml(i.message)}</div>
          <div class="code">${escapeHtml(i.code || i.source)}</div>
        </div>
        <span class="loc">${escapeHtml(loc)}</span>
      </div>
    `;
  }).join('');
}

listEl.addEventListener('click', async (e) => {
  const card = e.target.closest('.issue');
  if (!card) return;
  const issue = issues[parseInt(card.dataset.idx, 10)];
  if (!issue || !issue.file) return;
  await openFile(issue.file);
  if (issue.line) gotoLine(issue.line, issue.column);
});

function appendLog(text, cls) {
  if (!cls) { logEl.appendChild(document.createTextNode(text)); }
  else {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    logEl.appendChild(span);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function upsertJob(j) {
  jobs.set(j.id, j);
  renderJobs();
}

function renderJobs() {
  const arr = Array.from(jobs.values()).sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
  if (!arr.length) { jobsEl.innerHTML = `<div class="tree-empty">no jobs yet</div>`; return; }
  jobsEl.innerHTML = arr.map((j) => {
    const status = j.running ? 'running' : (j.passed ? 'pass' : 'fail');
    return `
      <div class="job-card" data-id="${j.id}">
        <div class="row1">
          <span class="toolname">${escapeHtml(j.toolName)}</span>
          <span class="status is-${status}">${status}</span>
        </div>
        <div class="row2">${escapeHtml(shortPath(j.target))}</div>
      </div>
    `;
  }).join('');
}

function shortPath(p) {
  if (!p) return '';
  const segs = String(p).split(/[\\/]/);
  return segs.slice(-3).join('/');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
