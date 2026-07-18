# Getting started

Arol scans a repository for usage of third-party APIs, SDKs, and model ids that are
deprecated or scheduled to be retired — cited by exact file and line. This page takes you
from nothing installed to a tuned CI gate.

## Install

No install needed — `npx` runs the latest version:

```sh
npx arol-ai scan
```

Prefer a global install (Node 18+):

```sh
npm install -g arol-ai
arol-ai scan
```

## Your first scan

Run it from the root of any repository:

```sh
npx arol-ai scan
```

This scans the directory you're standing in: it walks your source files
(`.js .ts .jsx .tsx .py .go` and friends), checks real usage against the deprecation
dataset, and prints a report — typically in a few seconds. Everything runs locally; your
code is never uploaded.

To scan somewhere else without changing directories, pass a path:

```sh
npx arol-ai scan ./my-repo
```

Useful when you keep several repos side by side, or in scripts that scan a checkout at a
known location. Everything else on this page works identically with or without the path
argument.

## Reading the report

```
● OpenAI · Assistants API (beta)  HIGH
  references a deprecated API · sunsets 2026-08-26 (in 40 days)
  found in:
    src/agents/run.ts:42  →  beta.assistants
  → migrate: https://platform.openai.com/docs/assistants/migration
```

Top to bottom: what's deprecated and how severe · when it breaks · the exact lines in
your code · the vendor's migration guide. A clean scan prints
`✓ No upcoming deprecations detected`. For what to *do* with a finding, see
[Handling scan failures](https://github.com/benminor/arol/blob/main/docs/failed-scan.md).

## Everyday options

### Skipping paths: `--ignore` and `.arolignore`

```sh
npx arol-ai scan --ignore 'docs/**' --ignore '**/*.gen.ts'
```

Dependency and build directories (`node_modules`, `dist`, `.venv`, `vendor`, …) are
skipped automatically — `--ignore` is for *your* paths: generated code, vendored examples,
fixture folders, anything you can't or won't fix. The flag is repeatable and takes
gitignore-style globs.

For permanent exclusions, put the same globs in a `.arolignore` file at the repo root so
every scan (local and CI) agrees:

```
# generated SDK examples we never run
examples/
**/*.gen.ts
```

Comments (`#`), leading `/` anchoring, and trailing `/` for directories all work like
`.gitignore`. `--ignore` flags and `.arolignore` combine — you never need to choose.

### Machine-readable output: `--json`

```sh
npx arol-ai scan --json
```

Emits the full scan as JSON instead of the report: file counts, dataset provenance
(`origin`, `fetchedAt`), severity counts, and every finding with its id, severity, status,
dates, vendor `source` URL, `confidence`, and exact file/line matches. Exit codes behave
identically, so you can keep the CI gate *and* feed dashboards or custom tooling:

```sh
# e.g. list finding ids with their sunset dates
npx arol-ai scan --json | jq -r '.findings[] | "\(.id)  \(.sunset_date)"'
```

The schema is treated as a public interface: fields get added over time, never renamed or
removed — safe to build scripts against.

### Plain text: `--no-color`

```sh
npx arol-ai scan --no-color
```

Disables ANSI colors for log archives and text diffs. You rarely need it explicitly:
colors already auto-disable when output isn't a terminal (piped or redirected), and the
standard `NO_COLOR` environment variable is respected. The inverse exists too —
`FORCE_COLOR=1` keeps colors on in CI systems that render them.

## Adding it to CI

One line in any CI system. GitHub Actions:

```yaml
name: arol deprecation scan
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx arol-ai scan
```

`npx arol-ai scan` is the only line that matters — it works identically in GitLab CI,
CircleCI, Jenkins, or a cron job.

## Tuning the CI gate

Exit codes are designed so a red build always means something real:

| Code | Meaning |
| --- | --- |
| `0` | Clean, or warn-only findings (printed, not build-breaking). |
| `1` | An **actionable** finding — see below. |
| `2` | Misconfiguration: bad path, unreadable dataset, or **zero scannable files** (a mis-pointed scan must not go green). |

A finding is **actionable** when it is *high severity and not yet retired*, or *scheduled
to sunset within the window* (`--within <days>`, default 30). Medium/low findings outside
the window, dateless deprecations, and already-retired items are warn-only. Findings whose
only evidence is in test files never fail the build.

```sh
npx arol-ai scan --within 7        # only fail when a sunset is < 1 week out
npx arol-ai scan --fail-on-retired # also fail on already-past high-severity sunsets
```

## Advanced: dataset freshness & restricted environments

Before scanning, the CLI refreshes its deprecation dataset (one public JSON file, at most
once per 24h, cached in `~/.cache/arol`). This is **fail-soft**: network trouble means the
cached/bundled dataset is used and the scan proceeds — a build can never break because a
download did. The report header shows which was used (`dataset: updated today` /
`dataset: bundled`).

### Forcing a refresh: `arol-ai update`

```sh
arol-ai update
```

Fetches the latest dataset right now, ignoring the 24-hour window. The download is
validated *before* it replaces your cache — a truncated or corrupt file can never
overwrite a good one. Unlike `scan`, this command is deliberately loud: it exits `2` on
failure so you know the refresh didn't happen. Use it when a new deprecation was just
announced and you want to scan for it immediately, or in CI setups that pre-warm caches.

### Going fully offline: `--offline`

```sh
npx arol-ai scan --offline
```

Disables all network use for this run — behavior identical to versions before
auto-refresh existed. The scan uses the cached dataset if one exists, otherwise the copy
bundled with the CLI, and the report header says so (`· offline`). For CI runners and
air-gapped machines, set it environment-wide instead:

```sh
AROL_OFFLINE=1 npx arol-ai scan
```

`AROL_CACHE_DIR` relocates the cache directory when `~/.cache` isn't writable or you want
the dataset vendored alongside your pipeline.

### Bringing your own dataset: `--data`

```sh
npx arol-ai scan --data ./our-deprecations.json
```

Scans against your own file — same schema as the bundled dataset, so you can track
deprecations of *internal* APIs, or pin an exact reviewed dataset snapshot in regulated
environments. `--data` **replaces** the public dataset rather than merging with it, and
auto-refresh is skipped entirely: you control that file's freshness. Schema details:
[Dataset reference](https://github.com/benminor/arol/blob/main/docs/dataset.md).
