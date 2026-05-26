/* -----------------------------------------------------------------------------
 * server/tools/registry.ts
 *
 * Single source of truth for every tool Probatur knows about. The HTTP
 * route layer asks this registry for a tool by id and gets back the adapter
 * instance, which it can `plan()` and `parseFinal()` on.
 * -------------------------------------------------------------------------- */

import { ToolAdapter } from './base.js';
import { LintAdapter }    from './lint.js';
import { PhpStanAdapter } from './phpstan.js';
import { PsalmAdapter }   from './psalm.js';
import { PhpCsAdapter }   from './phpcs.js';
import { PhpMdAdapter }   from './phpmd.js';
import { PhpUnitAdapter } from './phpunit.js';
import { PestAdapter }    from './pest.js';
import { LaravelAdapter } from './laravel.js';
import { SymfonyAdapter } from './symfony.js';

const ADAPTERS: ToolAdapter[] = [
  new LintAdapter(),
  new PhpStanAdapter(),
  new PsalmAdapter(),
  new PhpCsAdapter(),
  new PhpMdAdapter(),
  new PhpUnitAdapter(),
  new PestAdapter(),
  new LaravelAdapter(),
  new SymfonyAdapter(),
];

const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

export function allTools(): ToolAdapter[] { return ADAPTERS.slice(); }

export function toolById(id: string): ToolAdapter | undefined { return BY_ID.get(id); }
