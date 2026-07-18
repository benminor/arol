# How detection works

Arol's core promise is a false-positive rate near zero: a finding should mean *your code
actually references a deprecated surface*. This page is the machinery behind that promise.

## Detection keys on usage, not presence

Having `openai` in your `package.json` triggers nothing by itself. Each dataset entry
declares a `match` mode:

- **`pattern`** (default) — fires only when a scanned source file actually references the
  deprecated surface. Two signal types:
  - **`detect.patterns`** — regexes for code identifiers, endpoint paths, params
    (`beta\.assistants`, `/v1/threads`, `hapikey\s*=`).
  - **`detect.models`** — model ids matched **only inside string literals**: an opening
    quote, the exact family name, an optional ISO date-snapshot suffix, the matching
    closing quote. `"gpt-4o"` and `"gpt-4o-2024-05-13"` match; `"gpt-4o-mini"` (a
    different model) and a bare mention in prose never do.
- **`sdk`** — fires on manifest presence alone; reserved for "this whole package is
  end-of-life" (e.g. `aws-sdk` v2).
- **`version`** — manifest presence *plus* a declared-version range.

## Four layers against false positives

1. **Import gating.** When an entry names SDKs, its patterns only run in files that
   actually import a matching package (`import`/`require` in JS/TS, `import`/`from` in
   Python). A file that merely *mentions* an API in a string or comment doesn't qualify.
   Model-id matches are never gated — a quoted model id is meaningful wherever it appears.
2. **Language scoping.** Entries declare which file extensions their signals are valid in
   (`applies_to`), so a Python-only pattern can never fire in a `.tsx` file.
3. **Comment stripping.** Comments are blanked before matching (string-aware, so the `//`
   in a URL literal isn't treated as a comment; offsets preserved, so line numbers stay
   exact). Commented-out code never fires.
4. **Test down-ranking.** Findings whose only evidence lives in test files
   (`test/`, `__tests__/`, `*.test.ts`, `test_*.py`, …) are capped at low severity and
   never fail CI — deprecated references in tests are informational, not breakage.

## What gets scanned

- **Source extensions:** `.js .mjs .cjs .jsx .ts .mts .cts .tsx .py .go`
- **Manifests parsed:** `package.json` (all dependency fields + npm workspaces),
  `requirements.txt`, `go.mod`
- **Skipped by default:** dependency/build dirs (`node_modules`, `dist`, `.venv`,
  `vendor`, …), docs/prose (`.md`, `.txt`), files over 2 MB, and anything in
  `.arolignore` / `--ignore` globs
- Every match records **file, line, and the exact matched text** — findings cite
  evidence, never vibes.

## Where the data comes from

Every dataset entry carries `source` (the vendor notice it derives from) and `confidence`
(`confirmed` / `reported` / `inferred`). Entries are drafted by a pipeline that diffs
vendor lifecycle pages daily, human-reviewed before merge, and validated by fixtures
proving they fire on real usage and never on the replacement API. Details:
[The dataset](https://github.com/benminor/arol/blob/main/docs/dataset.md).

## Known limits (honest list)

- Matching is lexical. Dynamic values (`model = config.get("MODEL")`), string
  concatenation, and wrapper indirection can evade detection.
- Config files (`.env`, YAML, JSON) aren't scanned yet; model ids living there are
  invisible until read into scanned source.
- Go files are scanned but not yet import-gated.
- Declared manifest versions are used as written (`^2.1.0` reads as 2.1.0); lockfiles
  aren't resolved yet.

If a finding still looks wrong after all this:
[open an issue](https://github.com/benminor/arol/issues) — dataset corrections reach every
user within 24 hours.
