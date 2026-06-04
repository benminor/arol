# arol-ai

Scan a local code repo for usage of third-party APIs/SDKs that have **upcoming deprecations**, and print a clean report.

**Everything runs locally.** No network calls, no telemetry, no uploads, no auth. Your code never leaves your machine.

```
npx arol-ai scan
```

---

## Quick start

Scan the current directory:

```sh
npx arol-ai scan
```

Scan a specific path:

```sh
npx arol-ai scan ./path/to/repo
```

Install globally (optional):

```sh
npm install -g arol-ai
arol-ai scan
```

## Example output

```
arol · local deprecation scan
Scanned 128 files · 1 API detected

⚠ 1 deprecation found (1 high, 0 medium, 0 low)

● OpenAI · Assistants API (beta)  HIGH
  sunsets 2026-08-26 (in 84 days)
  The Assistants API beta is being removed on Aug 26, 2026; requests to
  /v1/assistants and /v1/threads will fail. Migrate to the Responses API +
  Conversations API.
  found in:
    src/agents/run.ts:42  →  beta.assistants
    src/agents/run.ts:88  →  beta.threads
  → migrate: https://platform.openai.com/docs/assistants/migration

These are today's deprecations. New ones land constantly — get
alerted before the next one breaks you → arol.ai
```

Note the citations point at the **exact source lines that use the deprecated API**, not at the manifest. Having the `openai` package installed is not enough on its own — your code has to actually call the removed surface.

When nothing is found:

```
✓ No upcoming deprecations detected in your stack.
```

## How detection works

Detection keys on **actual usage, not mere SDK presence.** Each dataset entry declares a `match` mode that decides what triggers it.

### `match: "pattern"` — the default

Flags **only** when one of the entry's `detect.patterns` regexes matches inside a scanned **source file** — i.e. your code actually references the deprecated endpoint, method, or model string. `detect.sdk` is just a scope hint here and is **never** a trigger on its own. This is the default and covers almost everything.

- Extensions scanned: `.js .mjs .cjs .jsx .ts .mts .cts .tsx .py .go`
- Skipped directories: `node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `coverage`, `.venv`, `venv`, `vendor`
- Each hit records the **file path, line number, and matched text**, and one deprecation aggregates **all** of its matched locations into a single finding.

> Having the `openai` package in `requirements.txt` does **not** flag the Assistants API deprecation. Your code has to actually use `beta.assistants` / `beta.threads` (etc.).

### `match: "sdk"`

Flags when a `detect.sdk` package appears in a manifest, **regardless of code** — for the rare "this whole SDK / version line is end-of-life" case.

### `match: "version"`

Flags when a `detect.sdk` package appears in a manifest **and** its declared version satisfies the entry's `version_range` (e.g. `"<3.0.0"`). Semver-style compare for npm; best-effort numeric compare for pip/go. If `version_range` is omitted, it behaves like `"sdk"`. *(No version entries ship today.)*

**Manifests parsed** (used by `sdk`/`version` modes): `package.json` (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, plus simple npm `workspaces`), `requirements.txt` (Python), and `go.mod` (Go). A dependency matches a `detect.sdk` name case-insensitively, with PyPI-style `_ . -` normalization.

The report cites **source code locations** for `pattern` findings, and the **manifest line** (`package.json → name@version`) for `sdk`/`version` findings.

## CLI

```
arol-ai scan [path] [options]
```

| Option | Description |
| --- | --- |
| `[path]` | Directory to scan (default: `.`) |
| `--json` | Output machine-readable JSON instead of the report |
| `--no-color` | Disable colored output (also respects `NO_COLOR`) |
| `--data <file>` | Use a custom `deprecations.json` instead of the bundled one |
| `--fail-on <severity>` | Exit non-zero if findings meet a level: `high` \| `medium` \| `low` \| `any` \| `none` (default `none`) |
| `-v, --version` | Print the version |
| `-h, --help` | Show help |

`scan` is the default command, so `arol-ai ./repo` works too.

**Exit codes:** `0` success · `1` `--fail-on` threshold met · `2` bad path or dataset error. The `--fail-on` flag makes `arol-ai` useful as a CI gate:

```sh
npx arol-ai scan --fail-on high
```

Colors are automatically disabled when output is not a TTY (e.g. piped to a file), or when `NO_COLOR` is set. Use `FORCE_COLOR=1` to force them on.

## The dataset (`deprecations.json`)

All detections are **data-driven** — the bundled dataset lives at
[`src/data/deprecations.json`](src/data/deprecations.json) and can be extended **without changing any code**. Add an entry and re-run; or keep your own file and pass it with `--data ./my-deprecations.json`.

### Schema

The dataset is either a bare array of entries, or a `{ "deprecations": [ ... ] }` object. A typical `pattern` entry:

```jsonc
{
  "id": "openai-assistants-api",    // unique, stable identifier (required)
  "vendor": "OpenAI",               // who owns the API (required)
  "title": "Assistants API (beta)", // short headline (required)
  "severity": "high",               // "high" | "medium" | "low" (required)
  "match": "pattern",               // "pattern" (default) | "sdk" | "version"
  "sunset_date": "2026-08-26",      // ISO YYYY-MM-DD, or "" if no fixed date
  "detect": {
    "sdk": ["openai"],              // scope hint for "pattern"; the trigger for "sdk"/"version"
    "patterns": [                   // regex strings matched against source files
      "beta\\.assistants",
      "beta\\.threads",
      "/v1/assistants"
    ]
  },
  "migration_url": "https://platform.openai.com/docs/assistants/migration",
  "summary": "One or two sentences explaining the change and what to do."
}
```

A `version` entry instead flags on the installed SDK version (no patterns needed):

```jsonc
{
  "id": "example-sdk-v2-eol",
  "vendor": "Example",
  "title": "example-sdk v2 line end-of-life",
  "severity": "medium",
  "match": "version",
  "version_range": "<3.0.0",        // flags only when the declared version is in range
  "sunset_date": "",
  "detect": { "sdk": ["example-sdk"], "patterns": [] },
  "migration_url": "https://example.com/migrate",
  "summary": "Upgrade example-sdk to v3+."
}
```

### Field reference

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | ✓ | Unique, stable slug. |
| `vendor` | string | ✓ | Displayed before the title. |
| `title` | string | ✓ | Short headline for the finding. |
| `severity` | `"high"` \| `"medium"` \| `"low"` | ✓ | Drives color, sort order, and `--fail-on`. |
| `match` | `"pattern"` \| `"sdk"` \| `"version"` | – | How the entry is triggered. **Defaults to `"pattern"`** when omitted. See [How detection works](#how-detection-works). |
| `version_range` | string | – | For `match: "version"` only — e.g. `"<3.0.0"`, `">=1.2.0"`, `"=2.1.0"`. If omitted, a `version` entry behaves like `"sdk"`. |
| `sunset_date` | string | – | ISO `YYYY-MM-DD`. Use `""` for unmaintained/no-fixed-date items; the report shows a relative hint (e.g. *"in 42 days"* / *"passed 12 days ago"*). |
| `detect.sdk` | string[] | – | Manifest dependency/module names. For `match: "pattern"` this is only a **scope hint and never triggers** a finding; for `sdk`/`version` it is the trigger. |
| `detect.patterns` | string[] | – | **JSON-escaped** regular-expression strings (so `\d` becomes `\\d`). Matched against source-file contents; invalid regexes are skipped safely. Required (non-empty) for `match: "pattern"`. |
| `migration_url` | string | – | Link shown in the report. |
| `summary` | string | – | One or two sentences of guidance. |

> A `pattern` entry with no `patterns`, or an `sdk`/`version` entry with no `sdk`, can never fire and is dropped at load time.

### Writing good patterns

- Patterns are matched **case-sensitively** with the global flag over each file's contents; the file path, line number, and matched text are reported.
- Match the **deprecated surface itself** — the method/property (`beta\.assistants`), endpoint path (`/v1/threads`), or model string (`claude-opus-4-20250514`) — not the import or the package name. Importing an SDK isn't usage; calling the removed API is.
- Escape backslashes (and literal dots) for JSON: a regex `beta\.assistants` is written `"beta\\.assistants"`.
- Avoid `^`/`$` line anchors — matching runs against the whole file, not line-by-line; use `\b` word boundaries instead.

## Development

```sh
npm install
npm run build          # tsc -> dist/
node dist/cli.js scan ./some/repo
npm run scan -- ./some/repo
```

Source layout:

| File | Responsibility |
| --- | --- |
| `src/cli.ts` | Argument parsing (`commander`), output mode, exit codes |
| `src/scanner.ts` | Orchestrates manifest + inline scans, combines findings |
| `src/manifests.ts` | Parsers for `package.json`, `requirements.txt`, `go.mod` |
| `src/report.ts` | Colorized terminal report rendering |
| `src/data.ts` | Loads & validates the dataset |
| `src/data/deprecations.json` | The bundled, extensible dataset |
| `src/types.ts` | Shared type definitions |

## Privacy

`arol-ai` makes **zero** network requests. It reads files under the path you point it at, matches them against a local JSON dataset, and prints to your terminal. Nothing is uploaded, logged remotely, or phoned home.

## License

MIT
