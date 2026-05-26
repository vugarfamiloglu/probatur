#!/usr/bin/env node
/* -----------------------------------------------------------------------------
 * server/index.ts
 *
 * Probatur boot.
 *   1. Express HTTP on :PORT
 *   2. WebSocket on the same HTTP server, path /ws  (live job progress)
 *   3. Static UI on / from ../ui
 *
 * Usage:
 *   npm run build && npm start
 *   then open http://localhost:4040
 *
 *   --smoke              run a tiny self-test (open this very repo,
 *                        enumerate it, lint package.json) and exit
 *   --port=XXXX          override the port
 * -------------------------------------------------------------------------- */

import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRouter } from './routes.js';
import { attachSocket } from './jobs.js';
import { setWorkspaceRoot, getWorkspaceRoot } from './util/safe-path.js';
import { buildWorkspaceInfo } from './workspace.js';
import { listDir } from './tree.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const uiDir      = resolvePath(__dirname, '..', '..', 'ui');

const argv = process.argv.slice(2);
const portArg = argv.find((a) => a.startsWith('--port='));
const PORT = Number(portArg ? portArg.split('=')[1] : process.env.PORT || 4040);
const SMOKE = argv.includes('--smoke');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(uiDir));
app.use('/api', buildRouter());

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws) => attachSocket(ws));

if (SMOKE) {
  /* Self-test: open the Probatur repo itself, walk top-level, exit. */
  (async () => {
    const here = resolvePath(__dirname, '..', '..');
    setWorkspaceRoot(here);
    const ws = await buildWorkspaceInfo(here);
    const tree = await listDir(here);
    console.log('\n=== Probatur smoke check ===');
    console.log('workspace root :', ws.root);
    console.log('framework      :', ws.frameworkLabel);
    console.log('top-level files:', tree.filter((e) => e.kind === 'file').length);
    console.log('top-level dirs :', tree.filter((e) => e.kind === 'dir').length);
    console.log('php files      :', ws.stats.phpFiles);
    console.log('tools detected :');
    for (const [id, info] of Object.entries(ws.tools)) {
      console.log(`  ${id.padEnd(10)} ${info.source.padEnd(12)} ${info.source === 'missing' ? '(missing)' : info.command}`);
    }
    console.log('\n  smoke check OK');
    process.exit(0);
  })().catch((e) => { console.error('smoke failed:', e); process.exit(1); });
} else {
  httpServer.listen(PORT, () => {
    console.log(`\n  ◆ Probatur — PHP project tester`);
    console.log(`     listening on  http://localhost:${PORT}`);
    console.log(`     ui served from ${uiDir}`);
    if (getWorkspaceRoot()) console.log(`     workspace     ${getWorkspaceRoot()}`);
    console.log(`     open the URL above, then drop a PHP project path into the "Open" prompt.\n`);
  });
}
