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

────────────────────────────────────────────────────────────
⚠ These break on fixed dates. Get alerted before the next one hits you → arol.ai
```

Note the citations point at the **exact source lines that use the deprecated API**, not at the manifest. Having the `openai` package installed is not enough on its own — your code has to actually call the removed surface.

The closing line is **severity-aware**: a high-severity finding gets the prominent warning above; findings with no high-severity items get `Get continuous deprecation alerts for your stack → arol.ai`; and a clean scan gets `✓ Clean today — but new deprecations land constantly. Stay covered → arol.ai`.

When nothing is found:

```
✓ No upcoming deprecations detected in your stack.
```

## How detection works

Detection keys on **actual usage, not mere SDK presence.** Each dataset entry declares a `match` mode that decides what triggers it.

### `match: "pattern"` — the default

Flags **only** when your code actually references the deprecated API in a scanned **source file**. `detect.sdk` is just a scope hint here and is **never** a trigger on its own. A `pattern` entry carries two kinds of usage signal:

- **`detect.patterns`** — raw regexes for code identifiers, endpoints, and params (e.g. `beta\.assistants`, `/v1/threads`, `charges\.create`, `hapikey\s*=`). Matched anywhere in the file.
- **`detect.models`** — model family names matched **only inside a string literal**. Each becomes: an opening quote (`'` `"` or `` ` ``), the family name, an optional `[A-Za-z0-9._-]*` version/suffix, then the matching closing quote. So `"gpt-4o"`, `'gpt-4o'`, `` `gpt-4o` ``, and `"gpt-4o-2024-05-13"` match — but the same name sitting in prose, JSX, or a comment does **not**.

This split is what keeps a marketing page that mentions *"GPT-4o, GPT-4.1, and o4-mini"* from being reported as deprecated usage: those names aren't quoted string literals, so `detect.models` ignores them. Only something like `model: "o4-mini"` counts.

Each hit records the **file path, line number, and matched text**, and one deprecation aggregates **all** of its matched locations into a single finding.

> Having the `openai` package in `requirements.txt` does **not** flag the Assistants API deprecation. Your code has to actually use `beta.assistants` / a deprecated model id (etc.).

**Files scanned / skipped**

- Extensions scanned: `.js .mjs .cjs .jsx .ts .mts .cts .tsx .py .go`
- Skipped directories: `node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `coverage`, `.venv`, `venv`, `vendor`
- Skipped by default: `.md`, `.mdx`, `.txt` (docs/prose, where model names appear as text), plus the tool's own `deprecations.json` and `arol.config.*` / `.arolignore` files.
- Add a **`.arolignore`** file (gitignore-style globs) at the repo root, and/or pass **`--ignore <glob>`** (repeatable) to skip more paths.

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
| `--ignore <glob>` | Skip files matching this glob; repeatable. Combined with `.arolignore`. e.g. `--ignore 'docs/**' --ignore '**/*.gen.ts'` |
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
    "patterns": [                   // raw regexes: identifiers, endpoints, params
      "beta\\.assistants",
      "beta\\.threads",
      "/v1/assistants"
    ],
    "models": []                    // model ids matched only inside string literals
  },
  "migration_url": "https://platform.openai.com/docs/assistants/migration",
  "summary": "One or two sentences explaining the change and what to do."
}
```

A model-retirement entry uses `detect.models` so it only fires on a quoted model id, never on prose:

```jsonc
{
  "id": "openai-gpt4-family-shutdown",
  "vendor": "OpenAI",
  "title": "GPT-4 family models (API shutdown)",
  "severity": "high",
  "match": "pattern",
  "sunset_date": "2026-10-23",
  "detect": {
    "sdk": ["openai"],
    "patterns": [],
    "models": ["gpt-4o", "gpt-4-turbo", "o4-mini", "gpt-4.5-preview"]
  },
  "migration_url": "https://platform.openai.com/docs/deprecations",
  "summary": "Migrate to the GPT-5 family."
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
| `detect.patterns` | string[] | – | **JSON-escaped** regex strings (so `\d` becomes `\\d`). For code identifiers, endpoints, and params. Matched anywhere in a source file; invalid regexes are skipped safely. |
| `detect.models` | string[] | – | Model family names matched **only inside string literals** (quote-anchored, with an optional version suffix). Use this for model ids so prose/JSX mentions don't false-positive. Write the raw name (e.g. `gpt-4.5-preview`) — escaping is automatic. |
| `migration_url` | string | – | Link shown in the report. |
| `summary` | string | – | One or two sentences of guidance. |

> A `pattern` entry needs at least one `detect.patterns` **or** `detect.models` entry; an `sdk`/`version` entry needs at least one `detect.sdk`. Entries that can never fire are dropped at load time.

### Writing good patterns & models

- **Put model ids in `detect.models`, not `detect.patterns`.** A bare model id as a raw pattern matches prose, JSX, comments, and changelogs. `detect.models` requires a quoted string literal, which is what real usage looks like (`model: "o4-mini"`).
- For `detect.models`, write the **raw family name** (e.g. `gpt-4.5-preview`, `claude-opus-4-20250514`) — escaping and quote-anchoring are automatic. The optional suffix means `gpt-4o` also catches `"gpt-4o-2024-05-13"`, so pick a family specific enough not to swallow a non-deprecated successor.
- For `detect.patterns`, match the **deprecated surface itself** — the method/property (`beta\.assistants`), endpoint path (`/v1/threads`), or param (`hapikey\s*=`) — not the import or package name. Importing an SDK isn't usage; calling the removed API is. Keep them specific (`client\.chat` is too broad — it hits unrelated SDKs).
- Patterns are matched **case-sensitively** with the global flag over each file's contents; the file path, line number, and matched text are reported.
- Escape backslashes (and literal dots) for JSON: a regex `beta\.assistants` is written `"beta\\.assistants"`. (Model entries don't need this — write `gpt-4.5-preview` as-is.)
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
