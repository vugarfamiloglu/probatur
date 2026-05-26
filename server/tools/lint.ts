/* -----------------------------------------------------------------------------
 * server/tools/lint.ts
 *
 * Syntactic check via PHP's built-in `php -l`. Works on a single file at a
 * time, so when the user targets a directory we walk it and run `php -l`
 * per .php file. That's slower than e.g. `find -exec`, but it lets us
 * stream issues to the UI as they're discovered instead of waiting for the
 * whole tree.
 *
 * The actual per-file iteration is done by the runner — this adapter only
 * knows how to lint ONE file.
 *
 * Output shape we parse:
 *   No syntax errors detected in /path/file.php          (OK)
 *   PHP Parse error:  syntax error, unexpected ',' …     (FAIL)
 *   Errors parsing /path/file.php
 * -------------------------------------------------------------------------- */

import { CommandPlan, Issue, ToolAdapter, ToolRunArgs } from './base.js';

export class LintAdapter extends ToolAdapter {
  readonly id   = 'lint';
  readonly name = 'PHP lint (php -l)';
  readonly kind = 'syntax' as const;

  plan(args: ToolRunArgs, command: string): CommandPlan {
    /* `command` here is always just `php`. */
    return {
      command,
      args: ['-l', '-n', args.target],
      cwd:  args.workspaceRoot,
    };
  }

  parseFinal(combined: string): Issue[] {
    const issues: Issue[] = [];
    /* Examples we handle:
     *   PHP Parse error:  syntax error, unexpected token "," in /x/y.php on line 12
     *   Parse error: syntax error, unexpected … in /x/y.php on line 12
     *   PHP Fatal error: …
     */
    const rx = /(?:PHP\s+)?(?:Parse|Fatal|Warning|Notice)\s*error:\s*(.+?)\s+in\s+(.+?)\s+on\s+line\s+(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(combined))) {
      issues.push({
        file:     m[2],
        line:     parseInt(m[3], 10),
        severity: 'error',
        message:  m[1].trim(),
        code:     'PHP-Parse',
        source:   this.id,
      });
    }
    return issues;
  }
}
