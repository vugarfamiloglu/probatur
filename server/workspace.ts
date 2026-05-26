/* -----------------------------------------------------------------------------
 * server/workspace.ts
 *
 * Detects what kind of PHP project the user opened so we can offer the right
 * tools and pre-fill the right test commands. We look at a handful of marker
 * files because every framework leaves a unique signature:
 *
 *   Laravel       artisan + composer.json:{"require":{"laravel/framework"}}
 *   Symfony       bin/console + composer.json:{"require":{"symfony/framework-bundle"}}
 *   CodeIgniter   system/CodeIgniter.php  OR  spark + composer.json:{"require":{"codeigniter4/framework"}}
 *   WordPress     wp-config.php  OR  wp-load.php
 *   Yii           yii  OR  yiisoft/yii2 in composer.json
 *   Slim          composer.json:{"require":{"slim/slim"}}
 *   Drupal        core/lib/Drupal.php  OR  drupal/core in composer.json
 *   Generic       any *.php anywhere
 *
 * We also walk composer.json once to pull php version, autoload paths, and
 * known dev-tools (phpunit/pest/phpstan/psalm/phpcs/phpmd) so the UI can
 * show install hints + run commands.
 * -------------------------------------------------------------------------- */

import { readFile, stat, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as FS } from 'node:fs';
import { commandExists } from './util/exec.js';

/* -- Probatur ships its own copy of the analyzers under <root>/vendor/bin/.
 * Compiled JS lives at <root>/dist/server/workspace.js, so the project root
 * is two directories above this file. Used as a fallback when the inspected
 * workspace doesn't have its own vendor/bin/. */
const PROBATUR_ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUNDLED_BIN_DIR = join(PROBATUR_ROOT, 'vendor', 'bin');

export type Framework =
  | 'laravel' | 'symfony' | 'codeigniter' | 'wordpress'
  | 'yii' | 'slim' | 'drupal' | 'generic';

export interface ComposerInfo {
  exists:           boolean;
  phpRequirement?:  string;
  autoload?:        { psr4?: Record<string, string | string[]>; classmap?: string[]; files?: string[] };
  devTools:         {
    phpunit?:  string;
    pest?:     string;
    phpstan?:  string;
    psalm?:    string;
    phpcs?:    string;
    phpmd?:    string;
  };
  scripts:          Record<string, unknown>;
  raw?:             unknown;
}

export interface DetectedTool {
  id:        string;              /* lint | phpstan | psalm | ... */
  name:      string;
  /** How we'll spawn it:
   *   'vendor'      — project-local <workspace>/vendor/bin/<tool>
   *   'bundled'     — Probatur's own <probatur>/vendor/bin/<tool>
   *   'system'      — binary on PATH
   *   'php-builtin' — `php` itself (used for `php -l`)
   *   'missing'     — nothing usable */
  source:    'vendor' | 'bundled' | 'system' | 'php-builtin' | 'missing';
  /** Absolute path / command to invoke. Empty if `source === 'missing'`. */
  command:   string;
  version?:  string;
  hint?:     string;
}

export interface WorkspaceInfo {
  root:        string;
  framework:   Framework;
  /** A short, human label for the framework, e.g. "Laravel 11.x". */
  frameworkLabel: string;
  composer:    ComposerInfo;
  /** Result of probing every supported tool against this workspace. */
  tools:       Record<string, DetectedTool>;
  /** Counts so the UI can show "1,284 PHP files". */
  stats:       { phpFiles: number; tests: number; lines: number };
  /** Suggested test paths the runner can default to (e.g. "tests/"). */
  testDirs:    string[];
}

const MARKERS: Array<[Framework, string[], (j?: any) => boolean]> = [
  ['laravel',     ['artisan'],                       (j) => has(j, 'laravel/framework')],
  ['symfony',     ['bin/console'],                   (j) => has(j, 'symfony/framework-bundle')],
  ['codeigniter', ['spark'],                         (j) => has(j, 'codeigniter4/framework')],
  ['codeigniter', ['system/CodeIgniter.php'],        ()  => true],          /* CI3 */
  ['wordpress',   ['wp-config.php'],                 ()  => true],
  ['wordpress',   ['wp-load.php'],                   ()  => true],
  ['yii',         ['yii'],                           (j) => has(j, 'yiisoft/yii2') || has(j, 'yiisoft/yii2-app-basic')],
  ['drupal',      ['core/lib/Drupal.php'],           ()  => true],
  ['slim',        [],                                (j) => has(j, 'slim/slim')],
];

function has(json: any, dep: string): boolean {
  if (!json) return false;
  return !!(json.require?.[dep] ?? json['require-dev']?.[dep]);
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p, FS.F_OK); return true; } catch { return false; }
}

async function readComposer(root: string): Promise<ComposerInfo> {
  const path = join(root, 'composer.json');
  if (!(await fileExists(path))) return { exists: false, devTools: {}, scripts: {} };
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    const dev = raw['require-dev'] || {};
    const req = raw.require || {};
    return {
      exists:          true,
      phpRequirement:  req.php || undefined,
      autoload:        raw.autoload,
      scripts:         raw.scripts || {},
      raw,
      devTools: {
        phpunit: dev['phpunit/phpunit'] || req['phpunit/phpunit'],
        pest:    dev['pestphp/pest']    || req['pestphp/pest'],
        phpstan: dev['phpstan/phpstan'] || req['phpstan/phpstan'],
        psalm:   dev['vimeo/psalm']     || req['vimeo/psalm'],
        phpcs:   dev['squizlabs/php_codesniffer'] || req['squizlabs/php_codesniffer'],
        phpmd:   dev['phpmd/phpmd']     || req['phpmd/phpmd'],
      },
    };
  } catch { return { exists: false, devTools: {}, scripts: {} }; }
}

/** Score-based framework detection — the first marker that matches wins. */
async function detectFramework(root: string, composer: ComposerInfo): Promise<{ id: Framework; label: string }> {
  for (const [fw, files, jsonCheck] of MARKERS) {
    let allPresent = true;
    for (const f of files) { if (!(await fileExists(join(root, f)))) { allPresent = false; break; } }
    if (allPresent && jsonCheck(composer.raw)) {
      return { id: fw, label: prettyLabel(fw, composer) };
    }
  }
  return { id: 'generic', label: composer.exists ? 'Generic PHP + Composer' : 'Generic PHP' };
}

function prettyLabel(fw: Framework, composer: ComposerInfo): string {
  const req = ((composer.raw as any)?.require || {}) as Record<string, string>;
  const map: Record<Framework, string> = {
    laravel:     'Laravel ' + (req['laravel/framework'] || ''),
    symfony:     'Symfony ' + (req['symfony/framework-bundle'] || ''),
    codeigniter: 'CodeIgniter ' + (req['codeigniter4/framework'] || ''),
    wordpress:   'WordPress',
    yii:         'Yii ' + (req['yiisoft/yii2'] || ''),
    slim:        'Slim ' + (req['slim/slim'] || ''),
    drupal:      'Drupal',
    generic:     'Generic PHP',
  };
  return map[fw].trim();
}

/** Look for every supported tool. Order of preference per tool:
 *   1. <workspace>/vendor/bin/<tool>   (project-local Composer install)
 *   2. <probatur>/vendor/bin/<tool>    (Probatur's bundled toolchain)
 *   3. system binary on PATH
 *   4. `php` itself (for lint) */
async function detectTools(root: string): Promise<Record<string, DetectedTool>> {
  const tools: Record<string, DetectedTool> = {};

  async function probe(id: string, name: string, binName: string, sysName: string | null): Promise<DetectedTool> {
    const fileName = binName + binSuffix();

    /* 1. project-local vendor/bin */
    const projectBin = join(root, 'vendor', 'bin', fileName);
    if (await fileExists(projectBin)) return { id, name, source: 'vendor', command: projectBin };

    /* 2. Probatur's bundled vendor/bin */
    const bundledBin = join(BUNDLED_BIN_DIR, fileName);
    if (await fileExists(bundledBin)) return { id, name, source: 'bundled', command: bundledBin };

    /* 3. system PATH */
    if (sysName && await commandExists(sysName)) return { id, name, source: 'system', command: sysName };

    /* 4. nothing usable */
    return {
      id, name, source: 'missing', command: '',
      hint: `not installed — run \`composer require --dev ${sysName}\` in your project, or reinstall Probatur's bundled toolchain (\`composer install\` in the Probatur folder)`,
    };
  }

  tools.lint    = await (async () => {
    if (await commandExists('php', '-v')) return { id: 'lint', name: 'PHP lint', source: 'php-builtin', command: 'php' } as DetectedTool;
    return { id: 'lint', name: 'PHP lint', source: 'missing', command: '', hint: '`php` not found on PATH — install PHP 8.0+' } as DetectedTool;
  })();

  tools.phpstan = await probe('phpstan', 'PHPStan',           'phpstan', 'phpstan');
  tools.psalm   = await probe('psalm',   'Psalm',             'psalm',   'psalm');
  tools.phpcs   = await probe('phpcs',   'PHP_CodeSniffer',   'phpcs',   'phpcs');
  tools.phpmd   = await probe('phpmd',   'PHP Mess Detector', 'phpmd',   'phpmd');
  tools.phpunit = await probe('phpunit', 'PHPUnit',           'phpunit', 'phpunit');
  tools.pest    = await probe('pest',    'Pest',              'pest',    'pest');

  /* Framework runners are technically just wrappers around phpunit, but the
   * UX wins are real — one click to run "php artisan test" etc. */
  const artisan = join(root, 'artisan');
  tools.laravel = await fileExists(artisan)
    ? { id: 'laravel', name: 'Laravel test (artisan)', source: 'system', command: artisan }
    : { id: 'laravel', name: 'Laravel test (artisan)', source: 'missing', command: '', hint: 'no artisan in workspace root' };

  const symfonyPhpunit = join(root, 'bin', 'phpunit' + binSuffix());
  tools.symfony = await fileExists(symfonyPhpunit)
    ? { id: 'symfony', name: 'Symfony test (bin/phpunit)', source: 'system', command: symfonyPhpunit }
    : { id: 'symfony', name: 'Symfony test (bin/phpunit)', source: 'missing', command: '', hint: 'no bin/phpunit in workspace root' };

  return tools;
}

function binSuffix(): string { return process.platform === 'win32' ? '.bat' : ''; }

/** Walk shallow to count PHP files + test files + total lines. Cheap enough
 * for first-open even on Laravel-scale projects (~few thousand files). */
async function quickStats(root: string): Promise<{ phpFiles: number; tests: number; lines: number }> {
  const { readdir } = await import('node:fs/promises');
  let phpFiles = 0, tests = 0, lines = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'vendor') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith('.php')) {
        phpFiles++;
        if (/Test\.php$|^Test|Tests?\.php$|Spec\.php$/.test(e.name)) tests++;
        try {
          const content = await readFile(full, 'utf8');
          lines += content.split('\n').length;
        } catch { /* ignore unreadable */ }
      }
    }
  }
  await walk(root, 0);
  return { phpFiles, tests, lines };
}

async function findTestDirs(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const candidate of ['tests', 'test', 'Tests', 'spec', 'specs']) {
    try {
      const s = await stat(join(root, candidate));
      if (s.isDirectory()) out.push(candidate);
    } catch { /* not there */ }
  }
  return out;
}

/** Build the full workspace info for a freshly opened folder. */
export async function buildWorkspaceInfo(root: string): Promise<WorkspaceInfo> {
  const composer  = await readComposer(root);
  const framework = await detectFramework(root, composer);
  const tools     = await detectTools(root);
  const [stats, testDirs] = await Promise.all([quickStats(root), findTestDirs(root)]);
  return {
    root,
    framework:      framework.id,
    frameworkLabel: framework.label,
    composer,
    tools,
    stats,
    testDirs,
  };
}
