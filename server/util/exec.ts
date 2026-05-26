/* -----------------------------------------------------------------------------
 * server/util/exec.ts
 *
 * Two helpers:
 *   commandExists(name)   — true if a binary is on PATH or fails cleanly
 *   spawnStream(cmd, …)   — spawn a child, get an async iterator of stdout +
 *                           stderr chunks plus a final exitCode promise.
 *
 * We deliberately avoid `child_process.exec` because it buffers everything
 * and a large `phpstan analyse` will easily exceed the default 1MB limit.
 * Streaming lets the front-end render output as it arrives.
 * -------------------------------------------------------------------------- */

import { spawn, ChildProcess, SpawnOptions } from 'node:child_process';

export interface SpawnStreamOptions extends SpawnOptions {
  /** Soft cap on combined stdout+stderr bytes — anything past this is
   * dropped (with a final 'overflow' chunk). Defaults to 5 MiB. */
  maxBytes?: number;
  /** Hard wall-clock timeout in ms; SIGKILL when exceeded. Default: 5 min. */
  timeoutMs?: number;
}

export interface OutputChunk {
  stream:   'stdout' | 'stderr' | 'meta';
  text:     string;
}

export interface SpawnResult {
  /** Async iterator of chunks as they arrive. */
  iter:     AsyncGenerator<OutputChunk>;
  /** Resolves with the process exit code (or null if killed by signal). */
  done:     Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; killed: boolean }>;
  /** The underlying ChildProcess — caller can kill it early via `proc.kill()`. */
  proc:     ChildProcess;
}

/** On Windows, args passed through `shell: true` are concatenated and re-parsed
 * by cmd.exe, so anything containing whitespace or shell metacharacters has to
 * be wrapped in double quotes (with internal quotes doubled). */
function quoteForCmd(s: string): string {
  if (s === '') return '""';
  if (!/[\s"&|<>^()%!,;=]/.test(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function spawnStream(
  command: string,
  args:    string[],
  opts:    SpawnStreamOptions = {},
): SpawnResult {
  const maxBytes  = opts.maxBytes  ?? 5 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  /* Windows: `.bat` / `.cmd` shims (e.g. Composer's vendor/bin/phpstan.bat)
   * cannot be passed to `spawn()` directly since Node 18 — the fix Node itself
   * recommends is to enable `shell: true`. We also have to pre-quote args + the
   * command because shell:true reassembles them as a single string. */
  const isWindowsBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(command);
  let cmd  = command;
  let argv = args;
  let extraOpts: SpawnOptions = {};
  if (isWindowsBatch) {
    cmd       = quoteForCmd(command);
    argv      = args.map(quoteForCmd);
    extraOpts = { shell: true, windowsVerbatimArguments: true };
  }

  const proc = spawn(cmd, argv, { ...opts, ...extraOpts, stdio: ['ignore', 'pipe', 'pipe'] });

  /* Pump stdout + stderr into a single queue that the async generator drains. */
  const queue: OutputChunk[] = [];
  let resolveNext: (() => void) | null = null;
  let finished = false;
  let total = 0;
  let overflowReported = false;

  function push(stream: 'stdout' | 'stderr' | 'meta', text: string) {
    total += text.length;
    if (total > maxBytes && !overflowReported) {
      overflowReported = true;
      queue.push({ stream: 'meta', text: `…output truncated at ${maxBytes} bytes` });
    } else if (!overflowReported) {
      queue.push({ stream, text });
    }
    resolveNext?.(); resolveNext = null;
  }
  proc.stdout?.on('data', (c: Buffer) => push('stdout', c.toString('utf8')));
  proc.stderr?.on('data', (c: Buffer) => push('stderr', c.toString('utf8')));

  const killTid = setTimeout(() => {
    push('meta', `…timeout after ${timeoutMs} ms, sending SIGKILL`);
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
  }, timeoutMs);

  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; killed: boolean }>((resolve) => {
    proc.once('exit', (code, signal) => {
      clearTimeout(killTid);
      finished = true;
      resolveNext?.(); resolveNext = null;
      resolve({ exitCode: code, signal, killed: proc.killed });
    });
    proc.once('error', (e) => {
      push('meta', `…spawn error: ${e.message}`);
      clearTimeout(killTid);
      finished = true;
      resolveNext?.(); resolveNext = null;
      resolve({ exitCode: null, signal: null, killed: false });
    });
  });

  async function* iter(): AsyncGenerator<OutputChunk> {
    while (true) {
      while (queue.length) yield queue.shift()!;
      if (finished) return;
      await new Promise<void>((res) => { resolveNext = res; });
    }
  }

  return { iter: iter(), done, proc };
}

/** Quick "does this binary exist + can be invoked" check. Tries `<cmd> --version`
 * with a short timeout and accepts any clean exit. */
export async function commandExists(cmd: string, versionArg = '--version'): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    try {
      /* On Windows, system PATH frequently has `.bat`/`.cmd` shims (e.g. a
       * Composer-global phpstan). spawn() can only invoke those through a
       * shell since Node 18, so we set shell:true on win32. */
      const p = spawn(cmd, [versionArg], {
        stdio: 'ignore',
        shell: process.platform === 'win32',
      });
      const tid = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} finish(false); }, 3000);
      p.once('exit', () => { clearTimeout(tid); finish(true); });
      p.once('error', () => { clearTimeout(tid); finish(false); });
    } catch { finish(false); }
  });
}
