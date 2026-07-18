# Running arol in CI

One line, sensible defaults, and exit codes designed so a red build always means
something real.

## Quick start (GitHub Actions)

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

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Clean, or warn-only findings (printed, but not build-breaking). |
| `1` | An **actionable** finding — see below. |
| `2` | Misconfiguration: bad path, unreadable dataset, or **zero scannable files** (a mis-pointed scan must not go green). |

A finding is **actionable** when it is *high severity and not yet retired*, or *scheduled
to sunset within the window* (`--within <days>`, default 30). Medium/low findings outside
the window, dateless deprecations, and already-retired items are warn-only. Findings whose
only evidence is in test files never fail the build.

Tune the gate:

```sh
npx arol-ai scan --within 7        # only fail when a sunset is < 1 week out
npx arol-ai scan --fail-on-retired # also fail on already-past high-severity sunsets
```

## Dataset freshness in CI

Before scanning, the CLI refreshes its deprecation dataset (one public JSON file, at most
once per 24h, cached). This is **fail-soft**: no network, proxy trouble, or a GitHub
outage means the cached/bundled dataset is used and the scan proceeds — a build can never
break because a download did. The report header shows what was used
(`dataset: updated today` / `dataset: bundled`).

Air-gapped or strict-egress runners: `--offline` or `AROL_OFFLINE=1` disables all network
use. Cache location: `~/.cache/arol` (override: `AROL_CACHE_DIR`).

## Machine-readable output

```sh
npx arol-ai scan --json
```

Emits scan stats, dataset provenance (`origin`, `fetchedAt`), and every finding with its
severity, status, dates, `source` URL, `confidence`, and exact matches. The JSON shape is
treated as a public interface: fields are added, not renamed or removed.

## Ignoring paths

`.arolignore` at the repo root (gitignore-style globs), and/or repeatable `--ignore`:

```sh
npx arol-ai scan --ignore 'docs/**' --ignore '**/*.gen.ts'
```

Build going red and you're not sure why? →
[A scan just failed your build](https://github.com/benminor/arol/blob/main/docs/failed-scan.md)
