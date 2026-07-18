# Privacy & network

The short version: **scanning uploads nothing. The only thing Arol ever sends anywhere is
a monitoring report you explicitly opt into with a token — and you can print exactly what
it contains before you ever send one.**

## What runs where

Scanning is entirely local. The CLI reads files under the path you point it at, matches
them against a local JSON dataset, and prints to your terminal. No telemetry, no crash
reporting, no account, no auth, no "anonymous usage statistics."

## Opt-in monitoring reports (`--report`)

Continuous monitoring needs your consent *and* your token — without both, nothing is ever
sent:

```sh
npx arol-ai scan --report <token>     # or AROL_REPORT_TOKEN in CI
```

What a report contains: **exactly what `--json` prints**, plus a repo name and the CLI
version. That means findings metadata (dataset entry ids, file paths, line numbers, the
matched identifier text) and your manifest inventory (dependency names and declared
versions). It never contains file contents, environment variables, or anything the
`--json` output doesn't show. To audit precisely what would be sent:

```sh
npx arol-ai scan --json
```

Reports are fail-soft (an unreachable endpoint warns on stderr and changes nothing about
the scan) and `--offline` wins over a present token: zero network means zero.

## Downloading the dataset

`scan` auto-refreshes its deprecation dataset: a plain HTTPS `GET` of a public JSON file
(the same
[`deprecations.json`](https://github.com/benminor/arol/blob/main/src/data/deprecations.json)
you can read in the repo), at most once per 24 hours. Like antivirus definitions —
download-only.

- The request carries **no identifying parameters** — nothing about your repo, your
  findings, or your machine beyond what any HTTPS request inherently reveals to the host.
- It is **fail-soft**: offline, proxied, or blocked, the scan silently uses the
  cached/bundled dataset. A scan never fails because a download did.
- A downloaded dataset is **validated before it replaces the cache**, and a corrupt cache
  falls back to the bundled copy with a warning.

## Zero-network mode

```sh
arol-ai scan --offline     # this run
AROL_OFFLINE=1             # environment-wide (CI, air-gapped machines)
```

Both disable all network use entirely — behavior identical to versions before
auto-refresh existed. The report header always tells you which dataset was used.

## Cache

The refreshed dataset lives at `~/.cache/arol` (`$XDG_CACHE_HOME/arol` respected;
override with `AROL_CACHE_DIR`). Delete it anytime; the CLI falls back to its bundled
dataset.

## Verifying all of this

The scanner is MIT-licensed and small (~3k lines):
[github.com/benminor/arol](https://github.com/benminor/arol). The only `fetch` calls in
the codebase are in `src/update.ts` (the dataset download) and `src/report-upload.ts`
(which runs solely with your token). Auditing both takes ten minutes — we'd encourage it.
