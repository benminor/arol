# Continuous monitoring

The free scanner tells you what's deprecated **right now**. Monitoring remembers
your dependency inventory and emails you when a **new** deprecation hits it -
so you don't have to re-scan to find out.

Free during early access; will be $99/mo. The local scanner stays free forever.

## Setup (about two minutes)

1. **Sign in** at [arol.ai/signin](https://arol.ai/signin) (creates your account).
2. **Create a token** at [arol.ai/dashboard/tokens](https://arol.ai/dashboard/tokens).
   Copy it once - plaintext is shown only at creation.
3. **Report** from a local scan or CI:

```sh
npx arol-ai@latest scan --report <token>
```

In CI, prefer a secret over a flag:

```sh
AROL_REPORT_TOKEN=<token> npx arol-ai@latest scan
```

The workflow that `arol-ai init` generates already passes `AROL_REPORT_TOKEN`
through - adding that secret in your repo's Actions settings is the only CI
step. You can also paste a token at `arol-ai init`'s prompt; it stores it in
`.git/arol-token` (git never commits that path).

Token resolution order: `--report` flag, then `AROL_REPORT_TOKEN`, then the
repo's saved token. No token means nothing is ever uploaded.

`--report-name <name>` overrides the repo name shown in the dashboard (default:
the scanned directory's name).

## What gets uploaded

Exactly what `--json` prints, plus a repo name and the CLI version:

- **Findings metadata** - dataset entry ids, file paths, line numbers, matched
  identifier text
- **Dependency inventory** - package names and declared versions from your
  manifests (npm, pip, go.mod, …)
- **Scan summary** - counts, dataset origin, timestamps

It never includes file contents, environment variables, source code, or
anything `--json` doesn't show. To audit a payload before enabling reporting:

```sh
npx arol-ai scan --json
```

Reporting is fail-soft: an unreachable endpoint warns on stderr and does not
change the scan result or exit code. `--offline` wins over a present token -
zero network means zero upload. Full network rules:
[Privacy & network](https://github.com/benminor/arol/blob/main/docs/privacy.md).

## What the dashboard shows

| Surface | Meaning |
| --- | --- |
| **Findings** | Deprecations the latest scan detected in your code (file + line) |
| **Sunsets** | Upcoming shutdown dates across your monitored repos |
| **Notifications** | Emails when a *new* dataset entry matches your inventory - even if you haven't re-scanned yet |
| **Repos** | Each reported project and its latest inventory / findings |

Findings come from code usage. Notifications come from inventory matching when
the public dataset gains a new entry. Both matter; they answer different
questions ("what breaks in this checkout?" vs "did something new land on my
stack?").

## How notifications work

When the Arol dataset updates:

1. New entry ids are diffed against ones already seen.
2. Each new entry's SDK package names are matched against every repo's **latest
   reported inventory**.
3. Matches become one email per user and a notification row in the dashboard
   (at-most-once per repo + entry).

Honest limits of the MVP:

- Only entries that name SDK packages can match an inventory. Pattern-only
  detections (e.g. raw query params with no package) won't trigger a
  notification until a scan finds them in code.
- Edits to an existing entry (sunset date moved, scope widened) do **not**
  re-notify - only brand-new entry ids do.
- The first time the notification pipeline runs for the live dataset, it seeds
  silently so you don't get a backlog of historical emails.

## Turning it off

- Remove `AROL_REPORT_TOKEN` from CI secrets (or stop passing `--report`).
- `rm .git/arol-token` if you saved one via `init`.
- Revoke the token in the dashboard - further reports with that token are
  rejected.

Scans without a token keep working exactly as before: local-only, free forever.
