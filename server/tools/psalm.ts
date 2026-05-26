/* -----------------------------------------------------------------------------
 * server/tools/psalm.ts
 *
 * Psalm — Vimeo's static analyser. Use `--output-format=json` for parseable
 * output. Psalm returns an array of issue objects directly (not nested
 * per-file like PHPStan).
 *
 *   [ { type, message, file_name, file_path, line_from, column_from,
 *       severity, snippet }, ... ]
 * -------------------------------------------------------------------------- */

import { CommandPlan, Issue, ToolAdapter, ToolRunArgs } from './base.js';

interface PsalmIssue {
  severity:    'error' | 'info';
  type:        string;
  message:     string;
  file_path:   string;
  line_from:   number;
  column_from?:number;
}

export class PsalmAdapter extends ToolAdapter {
  readonly id   = 'psalm';
  readonly name = 'Psalm';
  readonly kind = 'static' as const;

  plan(args: ToolRunArgs, command: string): CommandPlan {
    return {
      command,
      args: [
        '--no-progress',
        '--output-format=json',
        args.target,
        ...(args.extraArgs || []),
      ],
      cwd: args.workspaceRoot,
    };
  }

  parseFinal(combined: string): Issue[] {
    /* Psalm's JSON is an array. Find the first '[' and last ']' to be safe
     * about extra warnings printed before it. */
    const a = combined.indexOf('[');
    const b = combined.lastIndexOf(']');
    if (a < 0 || b <= a) return [];
    let arr: PsalmIssue[];
    try { arr = JSON.parse(combined.slice(a, b + 1)); } catch { return []; }
    return arr.map((p) => ({
      file:     p.file_path,
      line:     p.line_from,
      column:   p.column_from,
      severity: p.severity === 'error' ? 'error' : 'warning',
      message:  p.message,
      code:     p.type,
      source:   this.id,
    }));
  }
}
