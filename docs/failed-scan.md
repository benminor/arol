# Handling scan failures

You're here because `arol-ai scan` exited non-zero in CI. This page gets you from red to
green honestly — by fixing the real thing or confidently silencing a non-issue. Two minutes.

## 1. Read the finding

```
● OpenAI · Assistants API (beta)  HIGH
  references a deprecated API · sunsets 2026-08-26 (in 40 days)
  The Assistants API beta is being removed on Aug 26, 2026. Migrate to the
  Responses API + Conversations API.
  found in:
    src/agents/run.ts:42  →  beta.assistants
  → migrate: https://platform.openai.com/docs/assistants/migration
```

- **The status line is the stakes.** `sunsets <date> (in N days)` = it breaks on that date.
  `retired <date>` = it is already broken for new calls. `deprecated · no removal date` =
  vendor says it's going away, no date yet.
- **`found in` is evidence, not accusation.** Arol matched a textual reference at that exact
  file and line — it does not claim the call definitely executes in production. You judge that.
- **The migrate link is the vendor's own guide** for this exact change.

## 2. Why it failed the build (and not just warned)

A finding is **actionable** (exit 1) only when it is:

- **high severity** and not yet retired, or
- **scheduled to sunset within your window** — `--within <days>`, default 30.

Everything else (medium, low, dateless, already-retired) prints as a warning and exits 0.
So a red build means: \_something you reference breaks soon or breaks hard.\* Details:
[CI behavior & exit codes](https://github.com/benminor/arol/blob/main/docs/ci.md).

## 3. Decide: fix, schedule, or silence

**It's real production code → migrate.** Follow the finding's migrate link; the summary
names the replacement. Re-run the scan; green confirms every cited line is clean.

**It's real but you can't migrate today → shrink the window.**
`arol-ai scan --within 7` only fails the build when a sunset is inside a week — you keep
the warning visibility without blocking today's deploy. High-severity findings still fail
regardless of window; that's deliberate.

**It's in code that doesn't matter → exclude it.** Add a gitignore-style line to
`.arolignore` at the repo root:

```
# generated SDK examples we never run
examples/
**/*.gen.ts
```

Findings that live _only_ in test files are already down-ranked automatically and never
fail the build — you don't need to exclude your test tree.

**Already retired and you've accepted it →** retired high-severity findings are warn-only
unless you opted into `--fail-on-retired`. If it's failing, something is _scheduled_, not
retired — check the date.

## 4. Think it's a false positive?

Arol's matching is deliberately narrow (import-gated patterns, quote-anchored model ids,
comments stripped — [how detection works](https://github.com/benminor/arol/blob/main/docs/detection.md)),
but no matcher is perfect. Check the entry's own evidence first:

```sh
arol-ai scan --json | jq '.findings[] | {id, source, confidence}'
```

Every entry carries `source` (the vendor notice it's based on) and `confidence`
(`confirmed` = vendor-stated · `reported` = credible secondhand · `inferred` = triangulated).
If the vendor's page disagrees with the finding, [open an issue](https://github.com/benminor/arol/issues)
with the finding id — dataset fixes ship to all users within 24 hours, no release needed.
Use `.arolignore` to unblock yourself meanwhile.

## 5. Stay ahead of the next one

The dataset your scan used refreshes automatically (at most daily). A finding can appear
tomorrow that didn't exist today — that's the product working, not flakiness. If you'd
rather hear about new deprecations before CI does, that's what
[monitoring](https://arol.ai) is for.
