/* -----------------------------------------------------------------------------
 * server/tools/phpstan.ts
 *
 * PHPStan — static analysis. We invoke with `--error-format=json` and
 * `--no-progress` so we get one machine-readable blob at the end.
 * Per-file errors come back grouped by filename.
 *
 *   { totals: { errors: 5, file_errors: 5 },
 *     files:  { "/abs/Foo.php": { errors: 2, messages: [ { line, message, ... } ] } } }
 * -------------------------------------------------------------------------- */

import { CommandPlan, Issue, ToolAdapter, ToolRunArgs } from './base.js';

interface StanFile {
  errors:   number;
  messages: Array<{ line: number; message: string; ignorable?: boolean; identifier?: string }>;
}
interface StanReport {
  totals: { errors: number; file_errors: number };
  files:  Record<string, StanFile>;
  errors?: string[];
}

export class PhpStanAdapter extends ToolAdapter {
  readonly id   = 'phpstan';
  readonly name = 'PHPStan';
  readonly kind = 'static' as const;

  plan(args: ToolRunArgs, command: string): CommandPlan {
    return {
      command,
      args: [
        'analyse', args.target,
        '--no-progress',
        '--error-format=json',
        ...(args.extraArgs || []),
      ],
      cwd: args.workspaceRoot,
    };
  }

  parseFinal(combined: string): Issue[] {
    /* Strip everything before the first '{' — PHPStan sometimes prepends
     * Composer warnings to stderr. */
    const start = combined.indexOf('{');
    if (start < 0) return [];
    const json = combined.slice(start);
    let report: StanReport;
    try { report = JSON.parse(json); } catch { return []; }
    const issues: Issue[] = [];
    for (const [file, info] of Object.entries(report.files || {})) {
      for (const m of info.messages || []) {
        issues.push({
          file,
          line:     m.line,
          severity: 'error',
          message:  m.message,
          code:     m.identifier || 'phpstan',
          source:   this.id,
        });
      }
    }
    for (const e of (report.errors || [])) {
      issues.push({ file: '', severity: 'error', message: e, source: this.id });
    }
    return issues;
  }
}
