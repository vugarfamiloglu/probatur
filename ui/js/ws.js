/* -----------------------------------------------------------------------------
 * ui/js/ws.js — single-connection WebSocket client with topic-style listeners.
 * Auto-reconnects after 2s on disconnect so the UI keeps working through
 * server restarts. Subscribers can listen for: 'started' | 'log' | 'issue' |
 * 'done' | 'snapshot'.
 * -------------------------------------------------------------------------- */

const listeners = new Map();   /* eventType -> Set<fn> */
let ws = null;
let reconnectTid = 0;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.addEventListener('open',  () => emit('__open__', null));
  ws.addEventListener('close', () => {
    emit('__close__', null);
    clearTimeout(reconnectTid);
    reconnectTid = setTimeout(connect, 2000);
  });
  ws.addEventListener('error', (e) => console.warn('[ws] error', e));
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg && msg.type) emit(msg.type, msg);
  });
}

function emit(type, msg) {
  const set = listeners.get(type);
  if (!set) return;
  for (const fn of set) {
    try { fn(msg); } catch (e) { console.error('[ws listener]', e); }
  }
}

export const bus = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  },
};

connect();
