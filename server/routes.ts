/* -----------------------------------------------------------------------------
 * server/routes.ts
 *
 * REST surface mounted on Express. Deliberately small and explicit — every
 * route gets a comment about what it does and which page calls it.
 *
 *   GET  /api/health                  liveness probe
 *   POST /api/workspace/open          set/refresh the active workspace
 *   GET  /api/workspace               get cached WorkspaceInfo
 *   GET  /api/tree?path=...           list one level (lazy expand)
 *   GET  /api/file?path=...           read a file (capped at 512 KB)
 *   GET  /api/tools                   adapter catalogue
 *   POST /api/run                     start a job  → { jobId }
 *   GET  /api/jobs                    last N jobs
 *   GET  /api/jobs/:id                full job state incl. log tail
 * -------------------------------------------------------------------------- */

import { Router, Request, Response } from 'express';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { lookup as mimeLookup } from 'mime-types';
import { safeResolve, setWorkspaceRoot, getWorkspaceRoot } from './util/safe-path.js';
import { buildWorkspaceInfo, WorkspaceInfo } from './workspace.js';
import { listDir, summary } from './tree.js';
import { allTools, toolById } from './tools/registry.js';
import { startJob, listJobs, getJob } from './jobs.js';

const MAX_FILE_BYTES = 512 * 1024;
let workspaceCache: WorkspaceInfo | null = null;

export function buildRouter(): Router {
  const r = Router();

  r.get('/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

  /* -- workspace ---------------------------------------------------------- */
  r.post('/workspace/open', async (req: Request, res: Response) => {
    const { path } = req.body || {};
    if (typeof path !== 'string' || !path) {
      return res.status(400).json({ error: 'body.path (absolute string) is required' });
    }
    try {
      const s = await stat(path);
      if (!s.isDirectory()) return res.status(400).json({ error: 'path is not a directory' });
      setWorkspaceRoot(path);
      workspaceCache = await buildWorkspaceInfo(path);
      res.json({ ok: true, workspace: workspaceCache });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.get('/workspace', async (_req, res) => {
    if (!workspaceCache) return res.status(404).json({ error: 'no workspace open' });
    res.json(workspaceCache);
  });

  /* -- tree --------------------------------------------------------------- */
  r.get('/tree', async (req, res) => {
    const path = (req.query.path as string) || getWorkspaceRoot() || '';
    try {
      const entries = await listDir(path);
      res.json({ path: safeResolve(path), entries });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.get('/summary', async (req, res) => {
    const path = (req.query.path as string) || getWorkspaceRoot() || '';
    try { res.json(await summary(path)); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  /* -- file --------------------------------------------------------------- */
  r.get('/file', async (req, res) => {
    const path = (req.query.path as string) || '';
    try {
      const abs = safeResolve(path);
      const s   = await stat(abs);
      if (!s.isFile()) return res.status(400).json({ error: 'not a file' });
      if (s.size > MAX_FILE_BYTES) {
        return res.status(413).json({
          error: `file too large (${s.size} bytes; max ${MAX_FILE_BYTES})`,
          truncated: true,
        });
      }
      const content = await readFile(abs, 'utf8');
      res.json({
        path: abs,
        size: s.size,
        ext:  extname(abs).toLowerCase(),
        mime: mimeLookup(abs) || 'text/plain',
        content,
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  /* -- tools -------------------------------------------------------------- */
  r.get('/tools', (_req, res) => {
    res.json({
      tools: allTools().map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
      detected: workspaceCache?.tools || {},
    });
  });

  /* -- run a job ---------------------------------------------------------- */
  r.post('/run', async (req, res) => {
    const { tool, target, extraArgs } = req.body || {};
    if (!workspaceCache) return res.status(400).json({ error: 'open a workspace first' });
    const adapter = toolById(String(tool || ''));
    if (!adapter) return res.status(404).json({ error: `unknown tool: ${tool}` });
    const detected = workspaceCache.tools[adapter.id];
    if (!detected || detected.source === 'missing') {
      return res.status(412).json({
        error:    `${adapter.name} is not installed in this workspace`,
        hint:     detected?.hint,
      });
    }
    let abs;
    try { abs = safeResolve(String(target || workspaceCache.root)); }
    catch (e) { return res.status(400).json({ error: (e as Error).message }); }

    const jobId = startJob(adapter, detected.command, {
      target:        abs,
      workspaceRoot: workspaceCache.root,
      extraArgs:     Array.isArray(extraArgs) ? extraArgs : undefined,
    });
    res.json({ jobId });
  });

  /* -- jobs --------------------------------------------------------------- */
  r.get('/jobs', (_req, res) => res.json({ jobs: listJobs() }));
  r.get('/jobs/:id', (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'no such job' });
    res.json(j);
  });

  return r;
}
