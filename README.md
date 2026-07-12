# [arol-ai](https://arol.ai)

[![tests](https://github.com/benminor/arol/actions/workflows/ci.yml/badge.svg)](https://github.com/benminor/arol/actions/workflows/ci.yml)

Scan a local code repo for usage of third-party APIs/SDKs that have **upcoming deprecations**, and print a clean report.

**Your code never leaves your machine.** Scanning is fully local and uploads nothing, ever. Like antivirus definitions, the CLI auto-downloads the latest public deprecation dataset (one JSON file, at most once a day) before scanning, so findings are as fresh as the last merged entry — no new install required. If the network is unavailable the scan silently uses the cached/bundled dataset; opt out entirely with `--offline` or `AROL_OFFLINE=1`.

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

Flags **only** when your code actually references the deprecated API in a scanned **source file**. Manifest presence alone never triggers a `pattern` entry. A `pattern` entry carries two kinds of usage signal:

- **`detect.patterns`** — raw regexes for code identifiers, endpoints, and params (e.g. `beta\.assistants`, `/v1/threads`, `charges\.create`, `hapikey\s*=`). Matched in the file **subject to import-gating** (below).
- **`detect.models`** — model family names matched **only inside a string literal**. Each becomes: an opening quote (`'` `"` or `` ` ``), the family name, an **optional ISO date snapshot** (`-YYYY-MM-DD`), then the matching closing quote — no arbitrary trailing characters. So `"gpt-4o"`, `'gpt-4o'`, `` `gpt-4o` ``, and `"gpt-4o-2024-05-13"` match, but a *different* model like `"gpt-4o-mini"` or `"gpt-4o-realtime-preview"` does **not** (and neither does a bare mention in prose, JSX, or a comment). Model matches are **not** import-gated — a quoted model id counts wherever it appears.

This split is what keeps a marketing page that mentions *"GPT-4o, GPT-4.1, and o4-mini"* from being reported as deprecated usage: those names aren't quoted string literals, so `detect.models` ignores them. Only something like `model: "o4-mini"` counts.

Three more layers keep matches context-aware:

- **Import-gating (`detect.sdk`).** When `detect.sdk` is non-empty, `detect.patterns` only run in files that **import** a matching package (JS/TS: `import`/`require`; Python: `import`/`from`). An empty `detect.sdk` means ungated — patterns run in every applicable file (useful for distinctive REST paths / query params with no SDK). Model matches always run regardless. Go files are not import-gated yet (patterns behave as ungated there). Subpaths count: `sdk: ["ai"]` matches `ai` and `ai/test`, but not `aimee` or `ai-utils`.
- **Language scoping (`applies_to`).** Each entry lists the file extensions its signals are valid in (e.g. `["py"]`, `["js","ts","jsx","tsx","mjs"]`, or `["*"]` for model strings). An entry is only tested against files with a matching extension, so a Python-only pattern like `openai.ChatCompletion` never fires in a `.tsx` file. Defaults to `["*"]` when omitted.
- **Comment stripping.** Before matching, comments are blanked out per language — `//`, `/* */`, JSX `{/* */}`, and `#` (Python). Stripping is string-aware: a marker inside a string literal (e.g. the `//` in `"https://…"`) is **not** treated as a comment, and offsets are preserved so reported line numbers stay exact. A commented-out `model: "gpt-4o"` is ignored; the real call on the next line is not.

Each hit records the **file path, line number, and matched text**, and one deprecation aggregates **all** of its matched locations into a single finding.

> Having the `openai` package in `requirements.txt` does **not** flag a `pattern` entry. Your code has to actually use the deprecated surface (and, for gated pattern entries, import the matching package) in a file of the right language, outside comments.

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
| `--fail-on-retired` | Also fail on **high**-severity findings whose sunset date is already past. Off by default. |
| `--offline` | Skip the dataset auto-refresh; scan with the cached/bundled dataset only (also: `AROL_OFFLINE=1`). |
| `-v, --version` | Print the version |
| `-h, --help` | Show help |

`scan` is the default command, so `arol-ai ./repo` works too.

### Dataset freshness (`arol-ai update`)

The deprecation dataset updates far more often than the CLI. `scan` therefore auto-refreshes it
before scanning — at most once per 24h, **fail-soft** (network trouble just means the cached or
bundled copy is used; a scan never breaks because a download did), and download-only (nothing
about you or your repo is sent; it is a plain GET of a public JSON file). The report's header
shows which dataset each scan used, e.g. `dataset: updated today` or `dataset: bundled`.

- `arol-ai update` — force a refresh right now (ignores the 24h window). Exit `2` on failure.
- The cache lives in `~/.cache/arol` (override with `AROL_CACHE_DIR`).
- A downloaded dataset is validated **before** it replaces the cache, and a corrupt cache
  falls back to the bundled dataset with a warning — never a broken scan.
- Air-gapped or strict-egress environments: `--offline` / `AROL_OFFLINE=1` disables all
  network use; you get exactly the pre-0.5 behavior.

**Exit codes:** `0` success · `1` an actionable finding · `2` bad path, dataset error, or zero scannable files.

A finding is **actionable** (exit `1`) when it is **high**-severity and **not retired**, or **scheduled** to sunset within `--within` days (default 30). Already-retired high findings, dateless `deprecated` findings, and non-imminent `medium`/`low` findings are **warn-only** (still printed, but exit `0`). Pass `--fail-on-retired` to also fail on retired high. This makes `arol-ai` a sensible CI gate with no flags:

```sh
npx arol-ai scan                 # fails on upcoming high / imminently-scheduled findings
npx arol-ai scan --within 7      # only fail when a sunset is within a week
npx arol-ai scan --fail-on-retired  # also fail on already-past high sunsets
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

1. **Exit codes fail the build only on real upcoming breaks.** By default the scan exits non-zero for high-severity findings that are still upcoming (or dateless), and for any finding scheduled within `--within` days. Already-retired high findings and warn-only medium/low stay exit `0` unless you pass `--fail-on-retired`.
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
    "sdk": ["openai"],              // import gate for patterns (empty = ungated)
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
| `match` | `"pattern"` \| `"sdk"` \| `"version"` | – | How the entry is triggered. **Defaults to `"pattern"`** when omitted. Entries with a match mode this CLI version doesn't recognize (from a newer dataset schema) are **skipped**, never misread — the dataset updates independently of the binary. See [How detection works](#how-detection-works). |
| `status` | `"deprecated"` \| `"scheduled"` \| `"retired"` | – | Lifecycle status. **Usually omit** — it's derived at runtime from `sunset_date`. Set explicitly only to override (e.g. force `"deprecated"`). |
| `applies_to` | string[] | – | File extensions (no dot) the entry's patterns/models are tested against, e.g. `["py"]` or `["js","ts","jsx","tsx","mjs"]`. Use `["*"]` for any file (model strings). **Defaults to `["*"]`** when omitted. |
| `version_range` | string | – | For `match: "version"` only — e.g. `"<3.0.0"`, `">=1.2.0"`, `"=2.1.0"`. If omitted, a `version` entry behaves like `"sdk"`. |
| `sunset_date` | string \| null | – | ISO `YYYY-MM-DD`, or **`null`** when no removal date is announced. Derived status: `null` → `deprecated`, future → `scheduled` (`"sunsets {date} (in N days)"`), past → `retired` (`"retired {date} (N days ago)"`). A dateless entry renders *"deprecated · no removal date announced"* and never runs date math. |
| `announced_date` | string \| null | – | ISO `YYYY-MM-DD` the vendor announced the deprecation, when known. Provenance metadata; not used for gating. |
| `source` | string | ✓* | URL of the vendor notice/page the entry's claims come from. Every claim should be checkable against it. (*Required in the bundled dataset; tolerated as empty in custom `--data` files.) |
| `confidence` | `"confirmed"` \| `"reported"` \| `"inferred"` | ✓* | How well-evidenced the entry is: `confirmed` = vendor-stated in `source`; `reported` = credible secondhand (e.g. a production incident); `inferred` = triangulated without an explicit vendor statement. (*Required in the bundled dataset.) |
| `detect.sdk` | string[] | – | Package / module names. For `match: "pattern"`: **import gate** for `detect.patterns` — patterns only run in files that import a matching package (JS/TS/Python); empty = ungated. Model matches are never gated. For `sdk`/`version`: the **manifest trigger**. |
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

**Nothing about you or your code is ever uploaded.** Scanning reads files under the path you
point it at, matches them against a local JSON dataset, and prints to your terminal — no
telemetry, no logging, no phoning home. The only network use in the entire tool is downloading
the latest public `deprecations.json` (a plain GET with no identifying parameters), and even
that is optional: pass `--offline` or set `AROL_OFFLINE=1` for zero network use, where the
tool behaves exactly as it did before auto-refresh existed.

## License

MIT
