# [arol-ai](https://arol.ai)

[![tests](https://github.com/benminor/arol/actions/workflows/ci.yml/badge.svg)](https://github.com/benminor/arol/actions/workflows/ci.yml)

Scan a local repo for third-party APIs, SDKs, and model ids with **upcoming deprecations** —
cited by exact file and line, gated for CI, powered by a dataset that updates itself daily.

**Your code never leaves your machine.** Scanning is fully local and uploads nothing, ever.
The CLI auto-downloads its public deprecation dataset (like antivirus definitions, ≤ once/day,
fail-soft); disable even that with `--offline`.

```sh
npx arol-ai scan
```

## What a finding looks like

```
arol · local deprecation scan
Scanned 128 files · 1 API detected
dataset: updated today

⚠ 1 deprecation found (1 high, 0 medium, 0 low)

● OpenAI · Assistants API (beta)  HIGH
  references a deprecated API · sunsets 2026-08-26 (in 40 days)
  The Assistants API beta is being removed on Aug 26, 2026. Migrate to the
  Responses API + Conversations API.
  found in:
    src/agents/run.ts:42  →  beta.assistants
    src/agents/run.ts:88  →  beta.threads
  → migrate: https://platform.openai.com/docs/assistants/migration
```

Citations point at the **exact source lines that use the deprecated surface** — having a
package installed is never enough on its own to flag.

## Use it as a CI gate

```yaml
# .github/workflows/arol.yml
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

Exit codes are designed so red always means something real: `1` only for **high-severity**
findings or sunsets **within your window** (`--within`, default 30 days); everything else is
warn-only. `0` clean · `2` misconfiguration. Portable to any CI — `npx arol-ai scan` is the
only line that matters.

## CLI

```
arol-ai scan [path] [options]     # default command — `arol-ai ./repo` works too
arol-ai update                    # force-refresh the dataset cache now
```

| Option | Description |
| --- | --- |
| `--json` | Machine-readable output (stable, additive schema) |
| `--within <days>` | CI-gate window for scheduled sunsets (default `30`) |
| `--fail-on-retired` | Also fail on already-past high-severity sunsets |
| `--ignore <glob>` | Skip paths (repeatable); also reads `.arolignore` |
| `--offline` | No network at all (also: `AROL_OFFLINE=1`) |
| `--data <file>` | Use your own dataset file |
| `--include-deps` | Also scan dependency/build dirs |
| `--no-color` | Plain output (also respects `NO_COLOR`) |

## Documentation

| Guide | For when |
| --- | --- |
| [A scan just failed your build](https://github.com/benminor/arol/blob/main/docs/failed-scan.md) | CI went red and you want green, honestly |
| [Running arol in CI](https://github.com/benminor/arol/blob/main/docs/ci.md) | Exit codes, windows, JSON output, air-gapped runners |
| [How detection works](https://github.com/benminor/arol/blob/main/docs/detection.md) | The false-positive machinery, and its honest limits |
| [The dataset](https://github.com/benminor/arol/blob/main/docs/dataset.md) | Schema, provenance, contributing entries, custom datasets |
| [Privacy & network behavior](https://github.com/benminor/arol/blob/main/docs/privacy.md) | Exactly what touches the network (and how to stop it) |

## The dataset, in one paragraph

Every detection comes from [`deprecations.json`](https://github.com/benminor/arol/blob/main/src/data/deprecations.json):
human-reviewed entries with the vendor's notice as `source`, a stated `confidence`, and
fixtures proving each fires on real usage and never on the replacement API. A pipeline diffs
vendor lifecycle pages daily and drafts new entries; merged entries reach every installed CLI
within 24 hours — no release, no update on your side. Contributions welcome — see
[the dataset guide](https://github.com/benminor/arol/blob/main/docs/dataset.md).

## Development

```sh
npm install
npm run build          # tsc -> dist/
npm test               # vitest
node dist/cli.js scan ./some/repo
```

| File | Responsibility |
| --- | --- |
| `src/cli.ts` | Arguments, output mode, exit codes |
| `src/scanner.ts` | File walk, comment stripping, import gating, matching |
| `src/manifests.ts` | `package.json` / `requirements.txt` / `go.mod` parsers |
| `src/data.ts` | Dataset loading, validation, cache resolution |
| `src/update.ts` | Dataset auto-refresh (`arol-ai update`) |
| `src/report.ts` | Terminal report rendering |
| `src/data/deprecations.json` | The dataset itself |

## License

MIT
