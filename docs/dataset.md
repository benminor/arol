# The dataset

All detection is data-driven. The bundled dataset lives at
[`src/data/deprecations.json`](https://github.com/benminor/arol/blob/main/src/data/deprecations.json),
auto-refreshes into every installed CLI within 24 hours of a merge, and can be extended
without touching code — including with your own private entries.

## How entries are made (and why you can trust them)

1. **Watch** — a pipeline diffs vendor changelogs, deprecation pages, and release notes
   daily.
2. **Draft** — when a page changes, an agent drafts the entry: dates, scope, detection
   patterns, and the vendor's own words quoted as evidence.
3. **Review** — a human approves every entry. Each ships with fixtures proving it fires
   on real usage and stays silent on the replacement API; CI rejects entries that don't.
4. **Ship** — merged entries reach every user's next scan via auto-refresh. No release.

Every entry records its provenance: `source` (the vendor notice URL) and `confidence` —
`confirmed` (vendor-stated in the source), `reported` (credible secondhand evidence, e.g.
a verified production incident), `inferred` (triangulated from the vendor's own "legacy"
language, compat-shim direction, or current-docs golden path).

## Schema

An entry, annotated:

```jsonc
{
  "id": "openai-assistants-api",        // stable slug (required)
  "vendor": "OpenAI",                   // (required)
  "title": "Assistants API (beta)",     // short headline (required)
  "severity": "high",                   // high | medium | low (required)
  "match": "pattern",                   // pattern (default) | sdk | version
  "applies_to": ["py", "js", "ts"],     // extensions the signals are valid in; ["*"] any
  "sunset_date": "2026-08-26",          // ISO date, or null = announced, no date
  "announced_date": null,               // ISO date the vendor announced, when known
  "detect": {
    "sdk": ["openai"],                  // import gate (pattern) / trigger (sdk, version)
    "patterns": ["\\bbeta\\.assistants\\b"],  // JSON-escaped regexes: the deprecated surface
    "models": []                        // model ids — matched only in string literals
  },
  "migration_url": "https://…",         // the vendor's migration guide
  "summary": "One or two sentences: what changes, what to do.",
  "source": "https://…",                // the notice these claims derive from (required)
  "confidence": "confirmed"             // confirmed | reported | inferred (required)
}
```

Behavioral notes: a `null` `sunset_date` derives status `deprecated` (warn-only unless
high severity); a future date derives `scheduled`; a past date `retired`. Entries with a
`match` mode a given CLI version doesn't recognize are **skipped, never misread** — data
and binary ship on different clocks by design.

## Authoring rules (the ones that keep false positives near zero)

- **Model ids go in `detect.models`, never `detect.patterns`.** Models are quote-anchored
  (matching only `"gpt-4o"`-style literals plus ISO date snapshots) so prose, JSX, and
  changelog text can't fire. Non-ISO snapshot ids (`claude-3-5-sonnet-20241022`) get
  their own `models` entry.
- **Patterns match the deprecated surface itself** — method (`beta\.assistants`),
  endpoint (`/v1/threads`), or param (`hapikey\s*=`) — never the import, never the
  replacement API. Keep them narrow; escape for JSON (`\\b`); avoid `^`/`$`.
- **Cite honestly.** `sunset_date` only if the vendor stated one; a missing date is
  `null`, not a guess. If scope is limited ("new accounts only", staged rollout), the
  summary must say so.
- **Fixtures, both directions.** A fire case in `fixtures/dirty/`, a replacement-API
  no-fire case in `fixtures/clean/`, and exact expectations in the integration test —
  derived from a real scan run, not hand-typed.

## Contributing an entry

PRs to `deprecations.json` are welcome — follow the rules above and include your `source`
URL and fixtures; CI enforces the rest (schema validity, regex compilation, the
status/date invariant, fixture behavior). A merged entry is live for every user within a
day. Missing a whole vendor? [Open an issue](https://github.com/benminor/arol/issues).

## Private/custom datasets

Point at your own file — same schema, internal APIs welcome:

```sh
arol-ai scan --data ./our-deprecations.json
```

`--data` skips auto-refresh entirely: you control that file's freshness.
