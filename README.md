# arol-ai

[![tests](https://github.com/benminor/arol/actions/workflows/ci.yml/badge.svg)](https://github.com/benminor/arol/actions/workflows/ci.yml)

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
- **`detect.models`** — model family names matched **only inside a string literal**. Each becomes: an opening quote (`'` `"` or `` ` ``), the family name, an **optional ISO date snapshot** (`-YYYY-MM-DD`), then the matching closing quote — no arbitrary trailing characters. So `"gpt-4o"`, `'gpt-4o'`, `` `gpt-4o` ``, and `"gpt-4o-2024-05-13"` match, but a *different* model like `"gpt-4o-mini"` or `"gpt-4o-realtime-preview"` does **not** (and neither does a bare mention in prose, JSX, or a comment).

This split is what keeps a marketing page that mentions *"GPT-4o, GPT-4.1, and o4-mini"* from being reported as deprecated usage: those names aren't quoted string literals, so `detect.models` ignores them. Only something like `model: "o4-mini"` counts.

Two more layers keep matches context-aware:

- **Language scoping (`applies_to`).** Each entry lists the file extensions its signals are valid in (e.g. `["py"]`, `["js","ts","jsx","tsx","mjs"]`, or `["*"]` for model strings). An entry is only tested against files with a matching extension, so a Python-only pattern like `openai.ChatCompletion` never fires in a `.tsx` file. Defaults to `["*"]` when omitted.
- **Comment stripping.** Before matching, comments are blanked out per language — `//`, `/* */`, JSX `{/* */}`, and `#` (Python). Stripping is string-aware: a marker inside a string literal (e.g. the `//` in `"https://…"`) is **not** treated as a comment, and offsets are preserved so reported line numbers stay exact. A commented-out `model: "gpt-4o"` is ignored; the real call on the next line is not.

Each hit records the **file path, line number, and matched text**, and one deprecation aggregates **all** of its matched locations into a single finding.

> Having the `openai` package in `requirements.txt` does **not** flag the Assistants API deprecation. Your code has to actually use `beta.assistants` / a deprecated model id (etc.), in a file of the right language, outside comments.

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
| `--within <days>` | Window (default `30`) for the CI gate's "scheduled soon" check. See exit codes. |
| `-v, --version` | Print the version |
| `-h, --help` | Show help |

`scan` is the default command, so `arol-ai ./repo` works too.

**Exit codes:** `0` success · `1` an actionable finding · `2` bad path or dataset error.

A finding is **actionable** (exit `1`) when it is **high**-severity, or **scheduled** to sunset within `--within` days (default 30). Dateless `deprecated` findings and non-imminent `medium`/`low` findings are **warn-only** (still printed, but exit `0`). This makes `arol-ai` a sensible CI gate with no flags:

```sh
npx arol-ai scan            # fails CI on high or imminently-scheduled findings
npx arol-ai scan --within 7 # only fail when a sunset is within a week
```

Colors are automatically disabled when output is not a TTY (e.g. piped to a file), or when `NO_COLOR` is set. Use `FORCE_COLOR=1` to force them on.

## Run arol in CI

Add a workflow file at `.github/workflows/arol.yml` in **your own repo**. GitHub Actions runs anything in `.github/workflows/` automatically — the filename is arbitrary — and this one triggers on every `push` and `pull_request`:

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

1. **Exit codes fail the build only on real breaks.** The scan exits non-zero only for high-severity or imminent dated deprecations, and stays warn-only (exit `0`) for `deprecated`/`medium` findings — so it won't block a PR over a deprecation that has no deadline.
2. **Portable to any CI.** `npx arol-ai scan` is the one line that matters (GitLab CI, CircleCI, a cron job, etc.); only the YAML wrapper above is GitHub-specific.

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
  "applies_to": ["py","js","ts","jsx","tsx","mjs"], // extensions to test; ["*"] = any
  "sunset_date": "2026-08-26",      // ISO YYYY-MM-DD, or null if no date announced
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

A model-retirement entry uses `detect.models` (and `applies_to: ["*"]`) so it only fires on a quoted model id, in any language, never on prose:

```jsonc
{
  "id": "openai-gpt4-family-shutdown",
  "vendor": "OpenAI",
  "title": "GPT-4 family models (API shutdown)",
  "severity": "high",
  "match": "pattern",
  "applies_to": ["*"],
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

A Python-only entry scopes itself with `applies_to: ["py"]`, so its patterns never fire in JS/TSX files that merely mention the API in prose:

```jsonc
{
  "id": "openai-python-v0-syntax",
  "vendor": "OpenAI",
  "title": "Legacy openai-python v0 call syntax",
  "severity": "high",
  "match": "pattern",
  "applies_to": ["py"],
  "sunset_date": "2023-11-06",
  "detect": { "sdk": ["openai"], "patterns": ["openai\\.ChatCompletion"] },
  "migration_url": "https://github.com/openai/openai-python/discussions/742",
  "summary": "Instantiate a client: client.chat.completions.create(...)."
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
  "sunset_date": null,
  "detect": { "sdk": ["example-sdk"], "patterns": [] },
  "migration_url": "https://example.com/migrate",
  "summary": "Upgrade example-sdk to v3+."
}
```

A **dateless** entry — deprecated with no removal date announced. `sunset_date: null`
makes its status `deprecated`; it renders *"deprecated · no removal date announced"* and
is warn-only (exit 0) unless it's high-severity:

```jsonc
{
  "id": "resend-audiences-deprecated",
  "vendor": "Resend",
  "title": "Audiences API (deprecated in favor of Segments)",
  "severity": "medium",
  "match": "pattern",
  "sunset_date": null,              // no removal date → status derives to "deprecated"
  "detect": { "sdk": ["resend"], "patterns": ["\\.audiences\\."] },
  "migration_url": "https://resend.com/docs/dashboard/segments",
  "summary": "Migrate audiences.* calls to the Segments API."
}
```

### Field reference

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | ✓ | Unique, stable slug. |
| `vendor` | string | ✓ | Displayed before the title. |
| `title` | string | ✓ | Short headline for the finding. |
| `severity` | `"high"` \| `"medium"` \| `"low"` | ✓ | Drives color, sort order, and the CI gate (high always fails). |
| `match` | `"pattern"` \| `"sdk"` \| `"version"` | – | How the entry is triggered. **Defaults to `"pattern"`** when omitted. See [How detection works](#how-detection-works). |
| `status` | `"deprecated"` \| `"scheduled"` \| `"retired"` | – | Lifecycle status. **Usually omit** — it's derived at runtime from `sunset_date`. Set explicitly only to override (e.g. force `"deprecated"`). |
| `applies_to` | string[] | – | File extensions (no dot) the entry's patterns/models are tested against, e.g. `["py"]` or `["js","ts","jsx","tsx","mjs"]`. Use `["*"]` for any file (model strings). **Defaults to `["*"]`** when omitted. |
| `version_range` | string | – | For `match: "version"` only — e.g. `"<3.0.0"`, `">=1.2.0"`, `"=2.1.0"`. If omitted, a `version` entry behaves like `"sdk"`. |
| `sunset_date` | string \| null | – | ISO `YYYY-MM-DD`, or **`null`** when no removal date is announced. Derived status: `null` → `deprecated`, future → `scheduled` (`"sunsets {date} (in N days)"`), past → `retired` (`"retired {date} (N days ago)"`). A dateless entry renders *"deprecated · no removal date announced"* and never runs date math. |
| `detect.sdk` | string[] | – | Manifest dependency/module names. For `match: "pattern"` this is only a **scope hint and never triggers** a finding; for `sdk`/`version` it is the trigger. |
| `detect.patterns` | string[] | – | **JSON-escaped** regex strings (so `\d` becomes `\\d`). For code identifiers, endpoints, and params. Matched anywhere in a source file; invalid regexes are skipped safely. |
| `detect.models` | string[] | – | Model family names matched **only inside string literals** (quote-anchored; allows an optional trailing ISO date snapshot `-YYYY-MM-DD`, nothing else). Use this for model ids so prose/JSX mentions don't false-positive and a family never matches a different model. Write the raw name (e.g. `gpt-4.5-preview`) — escaping is automatic. List dated/revisioned snapshots explicitly if they use a non-ISO suffix (e.g. Anthropic's `-20241022`). |
| `migration_url` | string | – | Link shown in the report. |
| `summary` | string | – | One or two sentences of guidance. |

> A `pattern` entry needs at least one `detect.patterns` **or** `detect.models` entry; an `sdk`/`version` entry needs at least one `detect.sdk`. Entries that can never fire are dropped at load time.

### Writing good patterns & models

- **Put model ids in `detect.models`, not `detect.patterns`.** A bare model id as a raw pattern matches prose, JSX, comments, and changelogs. `detect.models` requires a quoted string literal, which is what real usage looks like (`model: "o4-mini"`).
- For `detect.models`, write the **raw family name** (e.g. `gpt-4.5-preview`, `claude-opus-4-20250514`) — escaping and quote-anchoring are automatic. Matching is exact except for an optional trailing ISO date snapshot, so `gpt-4o` catches `"gpt-4o"` and `"gpt-4o-2024-05-13"` but **not** `"gpt-4o-mini"`. If a deprecated snapshot uses a non-ISO suffix (Anthropic's `claude-3-5-sonnet-20241022`, Gemini's `gemini-1.5-pro-002`), add that full id as its own `models` entry.
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
