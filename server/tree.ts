/* -----------------------------------------------------------------------------
 * server/tree.ts
 *
 * Lazy directory tree — every request returns ONE level of children. The UI
 * expands directories on demand so opening a giant Laravel project doesn't
 * stall on a single read. Each entry carries enough metadata for the
 * client-side tree to render icons + counts + click handlers.
 * -------------------------------------------------------------------------- */

import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { safeResolve } from './util/safe-path.js';

export interface TreeEntry {
  /** Absolute path on disk (sent to the client so subsequent calls don't need
   * to re-resolve). */
  path:        string;
  /** Just the filename, for display. */
  name:        string;
  /** 'dir' | 'file'. */
  kind:        'dir' | 'file';
  /** File extension (lowercase, includes the dot). Empty for dirs. */
  ext:         string;
  /** Bytes — files only. */
  size?:       number;
  /** Number of immediate children — dirs only, lazily computed. */
  childCount?: number;
  /** Heuristic role: 'config' | 'test' | 'controller' | 'model' | ... — useful
   * for the UI to pick an icon. */
  role?:       string;
  /** Hidden / vendor / node_modules — UI still shows them but greyed out. */
  hidden?:     boolean;
}

/* Standard ignore list — we still list them but flag as hidden so the tree
 * stays uncluttered. */
const ALWAYS_HIDDEN = new Set([
  '.git', '.svn', '.hg',
  'node_modules', 'vendor', '.idea', '.vscode',
  '.phpunit.cache', '.phpunit.result.cache',
  '.next', 'dist', 'build',
  '.DS_Store', 'Thumbs.db',
]);

/** List one directory level. The given `dir` is *already* validated by safeResolve. */
export async function listDir(dir: string): Promise<TreeEntry[]> {
  const abs = safeResolve(dir);
  const entries = await readdir(abs, { withFileTypes: true });
  const out: TreeEntry[] = [];
  for (const e of entries) {
    const full = join(abs, e.name);
    const hidden = e.name.startsWith('.') || ALWAYS_HIDDEN.has(e.name);
    if (e.isDirectory()) {
      out.push({
        path: full, name: e.name, kind: 'dir', ext: '',
        hidden,
        role: classifyDir(e.name),
      });
    } else if (e.isFile()) {
      let size: number | undefined;
      try { size = (await stat(full)).size; } catch { /* ignore */ }
      out.push({
        path: full, name: e.name, kind: 'file', ext: extOf(e.name),
        size, hidden, role: classifyFile(e.name),
      });
    }
  }
  /* Dirs first, then files; alphabetical inside each group. */
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function classifyDir(name: string): string {
  const n = name.toLowerCase();
  if (/^(tests?|specs?)$/.test(n))   return 'test';
  if (/^controllers?$/.test(n))      return 'controller';
  if (/^models?$/.test(n))           return 'model';
  if (/^views?$/.test(n))            return 'view';
  if (/^(migrations?|seeders?)$/.test(n)) return 'database';
  if (/^(config|configs)$/.test(n))  return 'config';
  if (/^public$/.test(n))            return 'public';
  if (/^routes?$/.test(n))           return 'route';
  if (/^app$/.test(n))               return 'app';
  if (/^src$/.test(n))               return 'src';
  return '';
}

function classifyFile(name: string): string {
  if (name === 'composer.json' || name === 'composer.lock') return 'composer';
  if (name === '.env' || name === '.env.example')           return 'env';
  if (name === 'phpunit.xml' || name === 'phpunit.xml.dist')return 'phpunit-config';
  if (name === 'phpstan.neon' || name === 'phpstan.neon.dist') return 'phpstan-config';
  if (name === 'psalm.xml' || name === 'psalm.xml.dist')    return 'psalm-config';
  if (name === '.php-cs-fixer.php' || name === 'phpcs.xml') return 'codestyle-config';
  if (name === 'artisan')   return 'laravel-cli';
  if (name === 'spark')     return 'codeigniter-cli';
  if (name.endsWith('.php')) {
    if (/Test\.php$|TestCase\.php$/.test(name)) return 'test';
    if (/Controller\.php$/.test(name))          return 'controller';
    if (/Model\.php$|Entity\.php$|Repository\.php$/.test(name)) return 'model';
    if (/Service\.php$|Manager\.php$/.test(name)) return 'service';
    if (/Trait\.php$/.test(name))               return 'trait';
    if (/Interface\.php$/.test(name))           return 'interface';
    if (/Abstract.+\.php$/.test(name))          return 'abstract';
    return 'php';
  }
  if (name.endsWith('.blade.php')) return 'blade';
  if (name.endsWith('.twig'))      return 'twig';
  if (name.endsWith('.json'))      return 'json';
  if (name.endsWith('.md'))        return 'markdown';
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yaml';
  if (name.endsWith('.sql'))       return 'sql';
  return '';
}

/** Recursively count immediate children for a list — slightly fancier than
 * just listDir, used by the workspace dashboard tile. */
export async function summary(root: string): Promise<{ dirs: number; files: number; phpFiles: number }> {
  let dirs = 0, files = 0, phpFiles = 0;
  async function walk(d: string): Promise<void> {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (ALWAYS_HIDDEN.has(e.name)) continue;
      const f = join(d, e.name);
      if (e.isDirectory()) { dirs++; await walk(f); }
      else if (e.isFile()) {
        files++;
        if (extOf(e.name) === '.php') phpFiles++;
      }
    }
  }
  await walk(safeResolve(root));
  return { dirs, files, phpFiles };
}

export function basenameOf(p: string): string { return basename(p); }
