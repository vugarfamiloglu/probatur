/* -----------------------------------------------------------------------------
 * server/tools/phpunit.ts
 *
 * PHPUnit — functional unit tests. We use `--teamcity` because (a) it streams
 * line-by-line so we can show live progress, (b) it gives us a clean
 * test-by-test breakdown without needing JUnit XML on disk.
 *
 * TeamCity messages we care about:
 *   ##teamcity[testSuiteStarted name='...']
 *   ##teamcity[testStarted   name='...' locationHint='php_qn://...']
 *   ##teamcity[testFailed    name='...' message='...' details='...']
 *   ##teamcity[testFinished  name='...' duration='42']
 *   ##teamcity[testIgnored   name='...']
 *
 * Issues we surface: failing tests as 'fail' severity, passing/skipped as
 * 'pass' or 'info'. The UI shows a green ✓ / red ✗ next to each test name.
 * -------------------------------------------------------------------------- */

import { CommandPlan, Issue, ToolAdapter, ToolKind, ToolRunArgs } from './base.js';

export class PhpUnitAdapter extends ToolAdapter {
  /* Annotated as `string` (not the literal) so PestAdapter/LaravelAdapter/
   * SymfonyAdapter can override `id` with a different string. */
  readonly id:   string   = 'phpunit';
  readonly name: string   = 'PHPUnit';
  readonly kind: ToolKind = 'test';

  plan(args: ToolRunArgs, command: string): CommandPlan {
    return {
      command,
      args: ['--teamcity', '--colors=never', args.target, ...(args.extraArgs || [])],
      cwd:  args.workspaceRoot,
    };
  }

  parseFinal(combined: string): Issue[] {
    const issues: Issue[] = [];
    const lines = combined.split(/\r?\n/);
    /* Cheap parser — we don't need full TeamCity quoting; we only care about
     * the {name, message, details, locationHint} fields. */
    const get = (line: string, key: string): string | undefined => {
      const m = new RegExp(`${key}='((?:\\\\'|[^'])*)'`).exec(line);
      if (!m) return undefined;
      return m[1].replace(/\|n/g, '\n').replace(/\|'/g, "'");
    };
    const fileFromHint = (hint?: string): string => {
      /* php_qn://C:/path/File.php::\Class::method  → C:/path/File.php */
      if (!hint) return '';
      const i = hint.indexOf('::');
      return hint.replace(/^php_qn:\/\//, '').slice(0, i > 0 ? i : undefined);
    };
    for (const line of lines) {
      if (line.startsWith('##teamcity[testFailed')) {
        issues.push({
          file:     fileFromHint(get(line, 'locationHint')),
          severity: 'fail',
          message:  (get(line, 'message') || 'test failed') + (get(line, 'details') ? '\n' + get(line, 'details') : ''),
          code:     get(line, 'name'),
          source:   this.id,
        });
      } else if (line.startsWith('##teamcity[testFinished')) {
        const name = get(line, 'name');
        if (name && !issues.some((i) => i.code === name && i.severity === 'fail')) {
          issues.push({
            file: '', severity: 'pass',
            message: name + ' — passed' + (get(line, 'duration') ? ` (${get(line, 'duration')}ms)` : ''),
            code: name, source: this.id,
          });
        }
      } else if (line.startsWith('##teamcity[testIgnored')) {
        issues.push({
          file: '', severity: 'info',
          message: (get(line, 'name') || 'test') + ' — skipped',
          code: get(line, 'name'), source: this.id,
        });
      }
    }
    return issues;
  }

  passed(exitCode: number | null, issues: Issue[]): boolean {
    /* PHPUnit returns 0 = all passed, 1 = failures, 2 = errors. Treat issues
     * with 'fail' severity as authoritative. */
    return exitCode === 0 && !issues.some((i) => i.severity === 'fail');
  }
}
