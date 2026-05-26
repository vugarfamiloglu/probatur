/* -----------------------------------------------------------------------------
 * server/tools/base.ts
 *
 * Every PHP-tool adapter (lint, phpstan, phpunit, …) extends `ToolAdapter`.
 * The adapter is responsible for two things:
 *
 *   1. building the right command line for the user's project + target
 *   2. parsing the tool's output into structured "issues" so the UI can
 *      put red squiggles on the editor and list problems in a table
 *
 * Subclasses don't deal with spawning, streaming, or job IDs — that's all
 * handled by the job manager + util/exec.ts. They just answer two questions:
 *   "how do I run?" and "what does my output mean?"
 * -------------------------------------------------------------------------- */

export type Severity = 'error' | 'warning' | 'info' | 'pass' | 'fail';

export interface Issue {
  file:     string;        /* absolute path */
  line?:    number;        /* 1-based */
  column?:  number;
  severity: Severity;
  message:  string;
  /** Tool-specific code, e.g. "PHP-Parser-Error" or "PHPStan-1404". */
  code?:    string;
  /** Source tool id ('lint' | 'phpstan' | ...). */
  source:   string;
}

export interface ToolRunArgs {
  /** Absolute path: file or directory inside the workspace. */
  target:        string;
  /** Workspace root — adapters use this to resolve `vendor/bin/<tool>`. */
  workspaceRoot: string;
  /** Optional extra command-line flags, free-form. */
  extraArgs?:    string[];
}

export interface CommandPlan {
  /** Absolute path / PATH-resolved binary to spawn. */
  command:  string;
  /** Args. */
  args:     string[];
  /** Working directory for the child. Default = workspace root. */
  cwd?:     string;
  /** Extra env vars (merged onto process.env). */
  env?:     Record<string, string>;
}

export type ToolKind = 'syntax' | 'static' | 'style' | 'test';

export abstract class ToolAdapter {
  /** Subclasses declare `readonly id = 'foo'` — we keep the *type* as `string`
   * (not the literal `'foo'`) so subclasses of subclasses can override it. */
  abstract readonly id:   string;
  abstract readonly name: string;
  /** 'syntax' | 'static' | 'style' | 'test' — used to group buttons in the UI. */
  abstract readonly kind: ToolKind;

  /** Plan the command — pure, no side effects. */
  abstract plan(args: ToolRunArgs, command: string): CommandPlan;

  /** Parse one chunk of tool output into issues (may emit zero). The runner
   * collects chunks AND the final exit code, then calls `parseFinal` to give
   * adapters a chance to summarise.
   *
   * Defaults: empty array. Subclasses override what's useful. */
  parseChunk(_text: string, _stream: 'stdout' | 'stderr'): Issue[] { return []; }

  /** Called once after the process exits with the *complete* combined output.
   * Many tools (phpstan/phpunit) emit JSON or a summary line that's easier to
   * parse all at once. */
  parseFinal(_combined: string, _exitCode: number | null): Issue[] { return []; }

  /** Heuristic from exitCode + issues — flips the summary tile to red. */
  passed(exitCode: number | null, issues: Issue[]): boolean {
    if (exitCode == null || exitCode !== 0) return false;
    return !issues.some((i) => i.severity === 'error' || i.severity === 'fail');
  }
}
