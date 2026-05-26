/* -----------------------------------------------------------------------------
 * server/tools/symfony.ts
 *
 * Symfony bundles PHPUnit at bin/phpunit, configured via phpunit.xml.dist.
 * We just invoke it with `--teamcity` and reuse the PHPUnit parser.
 * -------------------------------------------------------------------------- */

import { CommandPlan, ToolRunArgs } from './base.js';
import { PhpUnitAdapter } from './phpunit.js';

export class SymfonyAdapter extends PhpUnitAdapter {
  override readonly id   = 'symfony';
  override readonly name = 'Symfony test (bin/phpunit)';

  override plan(args: ToolRunArgs, command: string): CommandPlan {
    return {
      command,
      args: ['--teamcity', '--colors=never', args.target, ...(args.extraArgs || [])],
      cwd:  args.workspaceRoot,
    };
  }
}
