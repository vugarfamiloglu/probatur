/* -----------------------------------------------------------------------------
 * server/tools/phpcs.ts
 *
 * PHP_CodeSniffer — coding-standard / style violations (PSR-12, WordPress,
 * custom rulesets). Use `--report=json` for parseable output.
 *
 *   { "files": { "/abs/x.php": { "messages": [{ line, column, type, source, message }] } } }
 * -------------------------------------------------------------------------- */

import { CommandPlan, Issue, ToolAdapter, ToolRunArgs } from './base.js';

interface CsReport {
  files: Record<string, {
    messages: Array<{
      line: number; column: number; type: 'ERROR' | 'WARNING';
      source: string; message: string;
    }>;
  }>;
}

export class PhpCsAdapter extends ToolAdapter {
  readonly id   = 'phpcs';
  readonly name = 'PHP_CodeSniffer';
  readonly kind = 'style' as const;

  plan(args: ToolRunArgs, command: string): CommandPlan {
    return {
      command,
      args: [
        '--report=json',
        '--no-colors',
        args.target,
        ...(args.extraArgs || []),
      ],
      cwd: args.workspaceRoot,
    };
  }

  parseFinal(combined: string): Issue[] {
    const start = combined.indexOf('{');
    if (start < 0) return [];
    let r: CsReport;
    try { r = JSON.parse(combined.slice(start)); } catch { return []; }
    const out: Issue[] = [];
    for (const [file, info] of Object.entries(r.files || {})) {
      for (const m of info.messages || []) {
        out.push({
          file,
          line:     m.line,
          column:   m.column,
          severity: m.type === 'ERROR' ? 'error' : 'warning',
          message:  m.message,
          code:     m.source,
          source:   this.id,
        });
      }
    }
    return out;
  }
}
