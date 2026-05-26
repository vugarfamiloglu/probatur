# Probatur

> Open any PHP project — **Core / MVC / OOP, Laravel, Symfony, CodeIgniter, WordPress, Yii, Slim, Drupal** — and inspect / lint / static-analyse / unit-test any file or folder from a Visual-Studio-style tree UI in the browser.

Probatur means *"it is proven / tested / approved"* in Latin. The tool is a thin, fast quality console: it doesn't ship its own analysers — it spawns the project's own tools (`php -l`, PHPStan, Psalm, PHPCS, PHPMD, PHPUnit, Pest, `php artisan test`, Symfony's `bin/phpunit`) and surfaces their output in a single uniform UI.

| Capability | Tool wrapped | Triggered by |
|------------|--------------|--------------|
| Syntactic lint        | `php -l`          | ⚡ Lint button |
| Static analysis       | PHPStan, Psalm    | 🔍 PHPStan / 🔎 Psalm |
| Code-style            | PHP_CodeSniffer, PHPMD | 📐 PHPCS / 🧹 PHPMD |
| Unit tests            | PHPUnit, Pest     | 🧪 PHPUnit / 🌶 Pest |
| Framework integration | `php artisan test`, `bin/phpunit` | 🚀 Artisan / 🎼 Symfony |

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser (localhost:4040)                                            │
│  ┌──────────────┬──────────────────────────┬─────────────────────┐ │
│  │ EXPLORER     │ Source · Issues · Log    │ RECENT JOBS         │ │
│  │ (VS-style    │ Monaco editor + markers  │ live status         │ │
│  │  file tree)  │ run buttons              │ click → re-open     │ │
│  └──────────────┴──────────────────────────┴─────────────────────┘ │
│       │ REST (/api/…)             │ WebSocket /ws (job progress)    │
└───────┼───────────────────────────┼──────────────────────────────────┘
        ▼                            ▼
┌────────────────────────────────────────────────────────────────────┐
│  Node.js server                                                      │
│  ── tree walker  ── workspace detector  ── job manager  ── routes   │
│  ── 9 PHP tool adapters (lint / phpstan / psalm / phpcs / phpmd /   │
│       phpunit / pest / artisan / bin/phpunit)                       │
└────────────────────────────────────────────────────────────────────┘
        ▼ child_process.spawn
   ┌────────────────────────────────┐
   │ php, vendor/bin/<tool>, artisan│ → runs against user's project
   └────────────────────────────────┘
```

## Project layout

```
server/
├── index.ts             # Express + WebSocket boot
├── routes.ts            # HTTP API
├── jobs.ts              # job manager + WS broadcast
├── tree.ts              # lazy directory walker
├── workspace.ts         # framework detection (Laravel / Symfony / CI / WP …)
├── tools/
│   ├── base.ts          # ToolAdapter contract
│   ├── registry.ts      # adapter catalogue
│   ├── lint.ts          # php -l
│   ├── phpstan.ts       # PHPStan (--error-format=json)
│   ├── psalm.ts         # Psalm  (--output-format=json)
│   ├── phpcs.ts         # PHP_CodeSniffer (--report=json)
│   ├── phpmd.ts         # PHP Mess Detector (json)
│   ├── phpunit.ts       # PHPUnit (--teamcity)
│   ├── pest.ts          # Pest (--teamcity)
│   ├── laravel.ts       # php artisan test --teamcity
│   └── symfony.ts       # bin/phpunit --teamcity
└── util/
    ├── safe-path.ts     # path-traversal guard
    └── exec.ts          # streaming child_process

ui/
├── index.html           # 3-pane shell
├── app.css              # VS-style dark theme + tokens for light
├── img/logo.svg
└── js/
    ├── api.js           # REST wrapper
    ├── ws.js            # WebSocket bus
    ├── ui.js            # toast · tabs · theme
    ├── tree.js          # lazy file explorer
    ├── editor.js        # Monaco wrapper + markers
    ├── results.js       # live issues + run log + jobs side panel
    └── app.js           # top-level wiring
```

## Quick start

```bash
git clone <repo>
cd Probatur
npm install
npm run build      # tsc → dist/

# Optional but recommended — fetch the bundled PHP toolchain
# (PHPStan + Psalm + PHPCS + PHPMD + PHPUnit + Pest) so projects that
# don't ship their own vendor/bin still get full analysis out of the box.
# Requires PHP 8.0+ and Composer on PATH.
composer install

# Sanity check — opens this very repo and lists detected tools
npm run lint:smoke

# Start the server
npm start
# → open http://localhost:4040

# In the browser:
#  1. Click "📂 Open project…"  → paste absolute path
#  2. The tree appears on the left, workspace info on the right
#  3. Select any file or folder, then click ⚡/🔍/🧪/… in the toolbar
#  4. Issues stream into the Issues tab; live output into the Run-log tab
```

### Tool resolution order

For every supported tool, Probatur probes — in order — and uses the first hit:

1. **`<workspace>/vendor/bin/<tool>`** — the project's own Composer install (preferred, uses the exact version the project pins)
2. **`<probatur>/vendor/bin/<tool>`** — Probatur's bundled toolchain (the `composer install` step above)
3. **`<tool>` on system PATH** — a globally installed binary
4. **missing** — the toolbar button is dimmed with an install hint

The Workspace tab shows the resolved source as a coloured badge on every tool card, so you can see at a glance whether a run is using the project's PHPUnit or Probatur's bundled fallback.

## What gets detected automatically

When you open a folder, Probatur reads `composer.json` + scans for marker files and reports:

- **Framework**: laravel / symfony / codeigniter / wordpress / yii / slim / drupal / generic
- **PHP version requirement** (from `composer.json:require.php`)
- **Available tools**: per-tool `source ∈ {vendor, system, php-builtin, missing}` with install hint when missing
- **Stats**: PHP file count, test file count, line count
- **Test directories**: `tests/`, `test/`, `spec/` …

## Safety

- The server holds **one workspace root** at a time. Every `?path=...` query is run through `safeResolve()` — any `..` that escapes the root is rejected with HTTP 400.
- All file reads are capped at 512 KB; large files get a "truncated" hint instead of a UI freeze.
- Tool stdout/stderr is capped at 5 MiB per job (configurable) so a runaway PHPStan can't OOM the server.
- Probatur **never modifies your source** — every operation is read-only.

## REST API at a glance

| Method | Path                       | Body / query                 | What it does |
|--------|----------------------------|------------------------------|--------------|
| GET    | `/api/health`              |                              | liveness probe |
| POST   | `/api/workspace/open`      | `{ "path": "/abs/path" }`    | open + scan a workspace |
| GET    | `/api/workspace`           |                              | get last `WorkspaceInfo` |
| GET    | `/api/tree?path=`          |                              | list one directory level |
| GET    | `/api/file?path=`          |                              | read file content (≤ 512 KB) |
| GET    | `/api/tools`               |                              | adapter catalogue + per-workspace detection |
| POST   | `/api/run`                 | `{ tool, target, extraArgs? }` | start a job → returns `{ jobId }` |
| GET    | `/api/jobs`                |                              | last 50 jobs |
| GET    | `/api/jobs/:id`            |                              | full job state (incl. log tail) |

WebSocket `/ws` streams:

```
{ type: 'started',  jobId, job }
{ type: 'log',      jobId, stream: 'stdout'|'stderr'|'meta', text }
{ type: 'issue',    jobId, issue: { file, line, column, severity, message, code, source } }
{ type: 'done',     jobId, job }
```

## Roadmap (not yet implemented)

- Coverage rendering (PHPUnit clover.xml gutter colours)
- Diff view of "before / after fix" for PHPCBF
- Save + reload custom rulesets (PHPStan levels, PHPCS standards)
- One-click "fix style with PHPCBF / Rector"
- Multiple workspaces side-by-side
- Saved test profiles ("smoke / full / per-module")

## Screenshot

<img width="1919" height="914" alt="Screenshot_3" src="https://github.com/user-attachments/assets/c16483d9-9d2b-435e-9d78-2c3ca963a724" />

## License

MIT — see [LICENSE](LICENSE).
