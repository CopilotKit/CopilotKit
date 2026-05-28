# `bin/railway`

Single-file Ruby tooling for showcase Railway operations.

## Why

The Showcase platform lives on Railway across two environments (staging and
production). Day-to-day operations — promoting staging to production, pinning
services to immutable image digests, rolling a bad deploy back, auditing drift
between envs — used to require ad-hoc shell + GraphQL recipes. `bin/railway`
makes those operations first-class CLI subcommands with consistent flags,
exit codes, and production protection.

## Install

None. Requires system Ruby 3.x (stdlib only — no Bundler, no Gemfile).

```sh
showcase/bin/railway --help
```

## Auth

The tool reads a Railway API token from (in order):

1. `RAILWAY_TOKEN` environment variable
2. `~/.railway/config.json` (the `token` field, or `user.token`)

It never invokes `railway login`, `railway logout`, or `op`. If neither source
yields a token, it exits with code 2 and a clear error.

For GHCR digest resolution (`resolve-digest`, `pin`), set `GHCR_TOKEN` if you
need to read private packages; public packages work anonymously via the GHCR
`/token` endpoint.

## Subcommands

| Subcommand        | Purpose                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `snapshot`        | Capture an env's services + config into a YAML snapshot.                                            |
| `restore`         | Restore an env to a snapshot (force-redeploy each service).                                         |
| `rollback`        | Roll a single service back one deploy (or to a specific deployment id with `--to`).                 |
| `rollback-commit` | Restore an env to the snapshot committed at a given git SHA.                                        |
| `promote`         | Promote staging digests to production with prechecks.                                               |
| `pin`             | Pin a service to a specific image digest.                                                           |
| `env-diff`        | Diff two envs; exits 1 on drift.                                                                    |
| `resolve-digest`  | Resolve an image tag (e.g. `:latest`) to its `sha256:` digest.                                      |
| `lint-prod`       | CI gate (advisory): warn if any prod service is not digest-pinned. `--exit-zero` for advisory mode. |

Run any subcommand with `--help` for full flag list.

## Production protection

Every subcommand that mutates state requires both:

- `--yes` flag, **and**
- typed confirmation of the literal string `production` on stdin

…before any production mutation runs. `--non-interactive` skips the prompt
but still requires `--yes`. There is no way to mutate production without an
explicit acknowledgement.

## Exit codes

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| 0    | Clean / success                                                          |
| 1    | Drift detected, findings reported, or promote refused for policy reasons |
| 2    | Error (auth, network, GraphQL schema, refused confirmation, etc.)        |

## Worked example: promote staging → production

```sh
# 1. Audit drift first (read-only).
showcase/bin/railway env-diff staging production
# DRIFT: 3 finding(s)
#   service showcase-shell: digest sha256:abc != sha256:def
#   ...

# 2. Lint prod to confirm baseline is pinned.
showcase/bin/railway lint-prod
# OK: all production services digest-pinned.

# 3. Capture a "before" snapshot in case we need to roll back.
showcase/bin/railway snapshot --env production --output before-promote.yaml

# 4. Run the promote with prechecks. Production confirmation prompt fires here.
showcase/bin/railway promote --yes
# Type 'production' to confirm promote: production
# promoted showcase-shell -> ghcr.io/copilotkit/showcase-shell@sha256:def...
# ...

# If anything goes sideways:
showcase/bin/railway restore --env production --snapshot before-promote.yaml --yes
```

## CI integration

`.github/workflows/showcase_lint_prod.yml` runs `bin/railway lint-prod` on
every PR that touches `showcase/**`.

**Currently advisory** — the workflow passes `--exit-zero`, so findings print
to the job log but do not fail the PR. This lets us soak the check against
real production state before turning it into a hard gate. Once we've built
confidence the findings are clean, remove `--exit-zero` from the workflow to
flip the check to enforcing (exit 1 on drift).

Long-term contract: every production service must be pinned to an immutable
`ghcr.io/...@sha256:...` digest, and the lint job will fail any PR that
drifts away from that.

## Tests

```sh
ruby showcase/bin/spec/all_tests.rb
```

Tests are minitest (stdlib). They cover:

- argv parsing per subcommand
- snapshot YAML round-trip
- GHCR digest-resolution decision tree (mocked HTTP)
- production-protection prompt behavior

No Railway / GHCR network calls are made during tests.
