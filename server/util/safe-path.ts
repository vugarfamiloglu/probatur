/* -----------------------------------------------------------------------------
 * server/util/safe-path.ts
 *
 * Path-traversal guard. Every request that includes a path query parameter
 * (?path=...) gets sanitised here. The rule is: the resolved absolute path
 * MUST stay inside the currently-open workspace root. Without this, a
 * malicious / clumsy URL like `?path=../../../../etc/passwd` could read
 * anything the Node process can.
 *
 * The workspace root is held by the server in a single mutable slot — we
 * intentionally support exactly one open project at a time, like VS Code's
 * single-folder workflow.
 * -------------------------------------------------------------------------- */

import { resolve as resolvePath, normalize, isAbsolute, relative } from 'node:path';

/* Mutable singleton — set by /api/workspace/open, read by every other route. */
let WORKSPACE_ROOT: string | null = null;

export function setWorkspaceRoot(absPath: string): void {
  const r = resolvePath(absPath);
  WORKSPACE_ROOT = r;
}

export function getWorkspaceRoot(): string | null { return WORKSPACE_ROOT; }

/** Resolve a (possibly user-supplied) path against the workspace root and
 * confirm it doesn't escape. Throws on any violation. */
export function safeResolve(p: string): string {
  if (!WORKSPACE_ROOT) throw new Error('no workspace open — call POST /api/workspace/open first');
  const candidate = isAbsolute(p) ? p : resolvePath(WORKSPACE_ROOT, p);
  const normalised = normalize(candidate);
  const rel = relative(WORKSPACE_ROOT, normalised);
  /* `rel` starting with `..` means we'd be ABOVE the root → reject.
   * isAbsolute(rel) on Windows means a different drive → reject. */
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${p}`);
  }
  return normalised;
}

/** True if `p` is inside the current workspace (no throw). */
export function isInsideWorkspace(p: string): boolean {
  try { safeResolve(p); return true; } catch { return false; }
}
