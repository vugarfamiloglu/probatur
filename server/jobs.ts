/* -----------------------------------------------------------------------------
 * server/jobs.ts
 *
 * The job manager. When the client POSTs /api/run, we:
 *   1. mint a jobId,
 *   2. spawn the configured tool via spawnStream,
 *   3. pipe every output chunk through the adapter's parser,
 *   4. broadcast {jobId, type:'log'|'issue'|'progress'|'done'} to every
 *      attached WebSocket so the UI updates live.
 *
 * Jobs are kept in memory (no DB) — last 50 jobs accessible via /api/jobs.
 * -------------------------------------------------------------------------- */

import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { spawnStream } from './util/exec.js';
import { Issue, ToolAdapter, ToolRunArgs } from './tools/base.js';

export interface Job {
  id:         string;
  toolId:     string;
  toolName:   string;
  target:     string;
  startedAt:  number;
  finishedAt?:number;
  exitCode?:  number | null;
  passed?:    boolean;
  issues:     Issue[];
  /** Tail of combined output, capped — sent verbatim on /api/jobs/:id. */
  logTail:    string;
  /** Whether the spawn is still running. */
  running:    boolean;
}

const JOBS = new Map<string, Job>();
const SOCKETS = new Set<WebSocket>();
const MAX_JOBS = 50;
const MAX_LOG_TAIL = 64 * 1024;

export function attachSocket(ws: WebSocket): void {
  SOCKETS.add(ws);
  ws.on('close', () => SOCKETS.delete(ws));
  /* Send a snapshot of in-flight jobs on connect. */
  for (const j of JOBS.values()) {
    if (j.running) safeSend(ws, { jobId: j.id, type: 'snapshot', job: serialise(j) });
  }
}

function broadcast(msg: unknown): void {
  const text = JSON.stringify(msg);
  for (const ws of SOCKETS) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(text); } catch { /* ignore */ }
    }
  }
}

function safeSend(ws: WebSocket, msg: unknown): void {
  try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
}

function serialise(j: Job) {
  return {
    id: j.id, toolId: j.toolId, toolName: j.toolName, target: j.target,
    startedAt: j.startedAt, finishedAt: j.finishedAt,
    exitCode: j.exitCode, passed: j.passed,
    issueCount: j.issues.length,
    running: j.running,
  };
}

export function listJobs() {
  return Array.from(JOBS.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(serialise);
}

export function getJob(id: string): Job | undefined { return JOBS.get(id); }

/** Start a tool run. Returns the jobId immediately; progress streams via WS. */
export function startJob(
  adapter: ToolAdapter,
  command: string,
  args:    ToolRunArgs,
): string {
  const id = randomUUID();
  const job: Job = {
    id,
    toolId:    adapter.id,
    toolName:  adapter.name,
    target:    args.target,
    startedAt: Date.now(),
    issues:    [],
    logTail:   '',
    running:   true,
  };
  JOBS.set(id, job);
  evictOld();

  const plan = adapter.plan(args, command);
  broadcast({ jobId: id, type: 'started', job: serialise(job) });

  const stream = spawnStream(plan.command, plan.args, {
    cwd: plan.cwd, env: plan.env ? { ...process.env, ...plan.env } : undefined,
  });

  let combined = '';

  (async () => {
    for await (const chunk of stream.iter) {
      combined += chunk.text;
      job.logTail += chunk.text;
      if (job.logTail.length > MAX_LOG_TAIL) {
        job.logTail = '…[truncated]…\n' + job.logTail.slice(-MAX_LOG_TAIL);
      }
      broadcast({ jobId: id, type: 'log', stream: chunk.stream, text: chunk.text });
      /* Many adapters only parse the *complete* output (parseFinal) — but
       * give chunk-level parsers a chance too. */
      const chunkIssues = adapter.parseChunk(chunk.text, chunk.stream as 'stdout' | 'stderr');
      if (chunkIssues.length) {
        job.issues.push(...chunkIssues);
        for (const issue of chunkIssues) broadcast({ jobId: id, type: 'issue', issue });
      }
    }
    const { exitCode } = await stream.done;
    const finalIssues = adapter.parseFinal(combined, exitCode);
    if (finalIssues.length) {
      job.issues.push(...finalIssues);
      for (const issue of finalIssues) broadcast({ jobId: id, type: 'issue', issue });
    }
    job.exitCode   = exitCode;
    job.passed     = adapter.passed(exitCode, job.issues);
    job.finishedAt = Date.now();
    job.running    = false;
    broadcast({ jobId: id, type: 'done', job: serialise(job) });
  })().catch((e) => {
    job.running = false;
    job.finishedAt = Date.now();
    job.exitCode = null;
    job.passed = false;
    broadcast({ jobId: id, type: 'done', job: serialise(job), error: (e as Error).message });
  });

  return id;
}

function evictOld(): void {
  if (JOBS.size <= MAX_JOBS) return;
  const sorted = Array.from(JOBS.values()).sort((a, b) => a.startedAt - b.startedAt);
  while (JOBS.size > MAX_JOBS && sorted.length) {
    const drop = sorted.shift()!;
    if (drop.running) continue;
    JOBS.delete(drop.id);
  }
}
