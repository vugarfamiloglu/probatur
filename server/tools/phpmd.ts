/* -----------------------------------------------------------------------------
 * server/tools/phpmd.ts
 *
 * PHP Mess Detector — finds long methods, high cyclomatic complexity,
 * unused fields, and other smelly patterns.
 *
 * CLI: phpmd <path> json <rulesets>   (default rulesets: cleancode,codesize,
 * design,naming,unusedcode)
 *
 *   { version, package: { file: [ { beginLine, endLine, rule, ruleset,
 *                                    description, priority } ] } }
 * -------------------------------------------------------------------------- */

import { CommandPlan, Issue, ToolAdapter, ToolRunArgs } from './base.js';

interface MdViolation {
  beginLine: number; endLine: number;
  rule:      string;
  ruleset:   string;
  priority:  number;
  description: string;
}
interface MdReport {
  files?: Array<{ file: string; violations: MdViolation[] }>;
}

export class PhpMdAdapter extends ToolAdapter {
  readonly id   = 'phpmd';
  readonly name = 'PHP Mess Detector';
  readonly kind = 'style' as const;

  plan(args: ToolRunArgs, command: string): CommandPlan {
    const rulesets = (args.extraArgs && args.extraArgs[0])
      || 'cleancode,codesize,design,naming,unusedcode';
    return {
      command,
      args: [args.target, 'json', rulesets, ...(args.extraArgs?.slice(1) || [])],
      cwd:  args.workspaceRoot,
    };
  }

  parseFinal(combined: string): Issue[] {
    const start = combined.indexOf('{');
    if (start < 0) return [];
    let r: MdReport;
    try { r = JSON.parse(combined.slice(start)); } catch { return []; }
    const out: Issue[] = [];
    for (const f of (r.files || [])) {
      for (const v of (f.violations || [])) {
        out.push({
          file:     f.file,
          line:     v.beginLine,
          severity: v.priority <= 2 ? 'error' : 'warning',
          message:  v.description,
          code:     `${v.ruleset}/${v.rule}`,
          source:   this.id,
        });
      }
    }
    return out;
  }
}
