/* -----------------------------------------------------------------------------
 * server/tools/pest.ts
 *
 * Pest — the Laravel-flavoured PHPUnit wrapper. It inherits PHPUnit's
 * TeamCity output verbatim when launched with `--teamcity`, so we reuse the
 * same parser. We keep the adapter separate because the command is `pest`
 * (not `phpunit`) and the default test directory might differ.
 * -------------------------------------------------------------------------- */

import { PhpUnitAdapter } from './phpunit.js';
import { CommandPlan, ToolRunArgs } from './base.js';

export class PestAdapter extends PhpUnitAdapter {
  override readonly id   = 'pest';
  override readonly name = 'Pest';

  override plan(args: ToolRunArgs, command: string): CommandPlan {
    return {
      command,
      args: ['--teamcity', '--colors=never', args.target, ...(args.extraArgs || [])],
      cwd:  args.workspaceRoot,
    };
  }
}
