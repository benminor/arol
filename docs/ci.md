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

```sh
npx arol-ai scan            # scan the current directory
npx arol-ai scan ./my-repo  # or a specific path
```

The scan walks your source files (`.js .ts .jsx .tsx .py .go` and friends), checks real
usage against the deprecation dataset, and prints a report. Everything runs locally —
your code is never uploaded.

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

```sh
npx arol-ai scan --ignore 'docs/**'   # skip paths (repeatable)
npx arol-ai scan --json               # machine-readable output
npx arol-ai scan --no-color           # plain text (CI logs, pipes)
```

A `.arolignore` file at the repo root (gitignore-style globs) does the same as `--ignore`,
permanently.

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

```sh
arol-ai update                     # force a refresh now
npx arol-ai scan --offline         # no network at all (also: AROL_OFFLINE=1)
npx arol-ai scan --data ./own.json # your own dataset — auto-refresh skipped
```

Air-gapped runners: set `AROL_OFFLINE=1` and you have the fully-offline behavior;
`AROL_CACHE_DIR` relocates the cache. JSON output includes dataset provenance
(`origin`, `fetchedAt`) and, per finding, the vendor `source` URL and `confidence` — the
schema is treated as public: fields get added, never renamed or removed.
