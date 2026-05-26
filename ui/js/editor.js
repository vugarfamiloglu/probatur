/* -----------------------------------------------------------------------------
 * ui/js/editor.js — Monaco wrapper.
 * Loads Monaco via the CDN AMD loader (the script tag in index.html), then
 * exposes openFile() to swap content and setMarkers() to overlay issue
 * squigglies on the gutter.
 * -------------------------------------------------------------------------- */

import { api } from './api.js';

const host = document.getElementById('editor');
const openLabel = document.getElementById('open-file');

let editor = null;
let currentPath = '';
let ready = false;
const readyPromise = new Promise((resolve) => {
  /* `require` comes from the Monaco AMD loader script in index.html. */
  // eslint-disable-next-line no-undef
  require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.46.0/min/vs' } });
  // eslint-disable-next-line no-undef
  require(['vs/editor/editor.main'], () => {
    /* Match our app's dark theme. */
    monaco.editor.defineTheme('probatur-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: { 'editor.background': '#1e1e1e' },
    });
    editor = monaco.editor.create(host, {
      value: '',
      language: 'plaintext',
      theme:    'probatur-dark',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Cascadia Mono, Consolas, monospace',
      scrollBeyondLastLine: false,
    });
    ready = true;
    resolve();
  });
});

function langFromExt(ext) {
  switch (ext) {
    case '.php':
    case '.phtml':
    case '.inc':       return 'php';
    case '.blade.php':
    case '.twig':      return 'html';
    case '.json':      return 'json';
    case '.md':        return 'markdown';
    case '.yml':
    case '.yaml':      return 'yaml';
    case '.xml':       return 'xml';
    case '.sql':       return 'sql';
    case '.js':        return 'javascript';
    case '.ts':        return 'typescript';
    case '.css':       return 'css';
    case '.html':      return 'html';
    default:           return 'plaintext';
  }
}

export async function openFile(absPath) {
  await readyPromise;
  let res;
  try { res = await api.file(absPath); }
  catch (e) {
    editor.setValue(`// failed to open\n// ${e.message}`);
    return;
  }
  currentPath = res.path;
  openLabel.textContent = res.path;
  const lang = langFromExt(res.ext);
  const model = monaco.editor.createModel(res.content, lang);
  const old = editor.getModel();
  editor.setModel(model);
  if (old) old.dispose();
}

/** Overlay issue squigglies for one file. Issues without `line` are ignored. */
export async function setMarkers(filePath, issues) {
  await readyPromise;
  if (filePath !== currentPath) return;
  const model = editor.getModel();
  if (!model) return;
  const markers = issues
    .filter((i) => i.line)
    .map((i) => ({
      severity:    sevToMonaco(i.severity),
      message:     `${i.message}${i.code ? `\n  [${i.code}]` : ''}`,
      startLineNumber: i.line,
      startColumn:     i.column || 1,
      endLineNumber:   i.line,
      endColumn:       i.column ? i.column + 1 : 1000,
      source:      i.source,
    }));
  monaco.editor.setModelMarkers(model, 'probatur', markers);
}

export async function gotoLine(line, column) {
  await readyPromise;
  if (!editor) return;
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: column || 1 });
  editor.focus();
}

function sevToMonaco(sev) {
  switch (sev) {
    case 'error':
    case 'fail':    return 8;   /* monaco.MarkerSeverity.Error */
    case 'warning': return 4;   /* Warning */
    case 'info':    return 2;   /* Info */
    case 'pass':    return 1;   /* Hint */
    default:        return 4;
  }
}

export const editorBus = {
  currentPath: () => currentPath,
};
