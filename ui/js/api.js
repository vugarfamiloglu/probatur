/* -----------------------------------------------------------------------------
 * ui/js/api.js
 * Thin REST wrapper around the Probatur server. Each function maps 1:1 to a
 * route in server/routes.ts so the call sites read like prose.
 * -------------------------------------------------------------------------- */

const BASE = '';   /* same origin */

async function req(method, path, body) {
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(BASE + path, init);
  const json = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((json && json.error) || r.statusText);
  return json;
}

export const api = {
  health:       ()              => req('GET',  '/api/health'),
  openWorkspace:(path)          => req('POST', '/api/workspace/open', { path }),
  workspace:    ()              => req('GET',  '/api/workspace'),
  tree:         (path)          => req('GET',  '/api/tree?path=' + encodeURIComponent(path || '')),
  file:         (path)          => req('GET',  '/api/file?path=' + encodeURIComponent(path)),
  tools:        ()              => req('GET',  '/api/tools'),
  run:          (tool, target, extraArgs) => req('POST', '/api/run', { tool, target, extraArgs }),
  jobs:         ()              => req('GET',  '/api/jobs'),
  job:          (id)            => req('GET',  '/api/jobs/' + encodeURIComponent(id)),
};
