# Privacy & network behavior

The short version: **nothing about you or your code is ever uploaded. By anything. Ever.**

## What runs where

Scanning is entirely local. The CLI reads files under the path you point it at, matches
them against a local JSON dataset, and prints to your terminal. No telemetry, no crash
reporting, no account, no auth, no "anonymous usage statistics."

## The one network call

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
[github.com/benminor/arol](https://github.com/benminor/arol). The only `fetch` in the
codebase is in `src/update.ts`. Auditing it takes ten minutes — we'd encourage it.
