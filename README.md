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
Scanned 128 files · 3 APIs detected

⚠ 3 deprecations found (2 high, 1 medium)

● AWS · AWS SDK for JavaScript v2 end-of-support  HIGH
  sunsets 2025-09-08 (passed 269 days ago)
  The monolithic 'aws-sdk' (v2) entered maintenance mode in 2024 and reached
  end-of-support. Migrate to the modular AWS SDK for JavaScript v3.
  found in:
    package.json → aws-sdk@^2.1400.0
    src/storage.ts:1, 42
  → migrate: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrating-to-v3.html

...

These are today's deprecations. New ones land constantly — get
alerted before the next one breaks you → arol.ai
```

When nothing is found:

```
✓ No upcoming deprecations detected in your stack.
```

## How detection works

For every entry in the dataset, `arol-ai` runs two independent checks:

1. **Manifest scan** — parses the repo's root manifests for declared dependencies and their versions:
   - `package.json` (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, plus simple npm `workspaces`)
   - `requirements.txt` (Python)
   - `go.mod` (Go)

   A dependency matches if its name equals one of the entry's `detect.sdk` names (case-insensitively, with PyPI-style `_ . -` normalization).

2. **Inline scan** — walks source files and regex-matches each entry's `detect.patterns`, recording the file paths and line numbers.
   - Extensions scanned: `.js .mjs .cjs .jsx .ts .mts .cts .tsx .py .go`
   - Skipped directories: `node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `coverage`, `.venv`, `venv`, `vendor`

A deprecation is **detected** if its SDK is present **OR** any of its patterns match. Both kinds of evidence are shown in the report.

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

```jsonc
{
  "schema_version": 1,            // optional, informational
  "updated": "2026-06-01",        // optional, informational
  "deprecations": [
    {
      "id": "aws-sdk-js-v2-eos",  // unique, stable identifier (required)
      "vendor": "AWS",            // who owns the API (required)
      "title": "AWS SDK for JavaScript v2 end-of-support", // short headline (required)
      "severity": "high",         // "high" | "medium" | "low" (required)
      "sunset_date": "2025-09-08",// ISO YYYY-MM-DD, or "" if no fixed date
      "detect": {
        "sdk": ["aws-sdk"],       // dependency/module names to find in manifests
        "patterns": [             // regex strings matched against source files
          "require\\(\\s*['\"]aws-sdk['\"]\\s*\\)",
          "from\\s+['\"]aws-sdk['\"]"
        ]
      },
      "migration_url": "https://docs.aws.amazon.com/.../migrating-to-v3.html",
      "summary": "One or two sentences explaining the change and what to do."
    }
  ]
}
```

A bare top-level array (`[ { ...entry }, ... ]`) is also accepted.

### Field reference

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | ✓ | Unique, stable slug. |
| `vendor` | string | ✓ | Displayed before the title. |
| `title` | string | ✓ | Short headline for the finding. |
| `severity` | `"high"` \| `"medium"` \| `"low"` | ✓ | Drives color, sort order, and `--fail-on`. |
| `sunset_date` | string | – | ISO `YYYY-MM-DD`. Use `""` for unmaintained/no-fixed-date items; the report shows a relative hint (e.g. *"in 42 days"* / *"passed 12 days ago"*). |
| `detect.sdk` | string[] | – | Manifest dependency/module names. May be empty for pattern-only detection. |
| `detect.patterns` | string[] | – | **JSON-escaped** regular-expression strings (so `\d` becomes `\\d`). Matched per source file; invalid regexes are skipped safely. May be empty for manifest-only detection. |
| `migration_url` | string | – | Link shown in the report. |
| `summary` | string | – | One or two sentences of guidance. |

> An entry with **both** `detect.sdk` and `detect.patterns` empty can never match and is ignored.

### Writing good patterns

- Patterns are matched **case-sensitively** with the global flag over each file's contents; line numbers are reported.
- Escape backslashes for JSON: a regex `\bimport\b` is written `"\\bimport\\b"`.
- Prefer specific anchors (`require\(\s*['"]name['"]\s*\)`, `from\s+['"]name['"]`) over bare package names to avoid false positives.
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
