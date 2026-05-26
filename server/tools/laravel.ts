/* -----------------------------------------------------------------------------
 * server/tools/laravel.ts
 *
 * `php artisan test` — Laravel's wrapper around PHPUnit/Pest that boots the
 * framework first, so factories / migrations / providers all work. Output
 * is the same TeamCity stream PHPUnit emits when we add `--teamcity`.
 *
 * The command is composed as:  php  artisan  test  --teamcity  <target>
 * -------------------------------------------------------------------------- */

import { CommandPlan, ToolRunArgs } from './base.js';
import { PhpUnitAdapter } from './phpunit.js';

export class LaravelAdapter extends PhpUnitAdapter {
  override readonly id   = 'laravel';
  override readonly name = 'Laravel test (artisan)';

  override plan(args: ToolRunArgs, command: string): CommandPlan {
    /* `command` is the path to `artisan`. We need to invoke it via `php`. */
    const php = process.env.LUMEN_PHP || 'php';
    return {
      command: php,
      args: [command, 'test', '--teamcity', '--colors=never', ...(args.extraArgs || []),
             ...(args.target && args.target !== args.workspaceRoot ? [args.target] : [])],
      cwd:  args.workspaceRoot,
    };
  }
}
