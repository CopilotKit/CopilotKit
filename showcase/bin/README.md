# `bin/railway`

Tagline: Ruby CLI for showcase Railway day-to-day ops — snapshot, restore,
rollback, promote, pin, env-diff, resolve-digest, lint-prod. Mutating
subcommands require typed `production` confirmation. For fleet auto-update
config / new-service provisioning, see [`../RAILWAY.md`](../RAILWAY.md).

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

| Subcommand        | Purpose                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `snapshot`        | Capture an env's services + config into a YAML snapshot.                                                                                         |
| `restore`         | Restore an env to a snapshot (force-redeploy each service).                                                                                      |
| `rollback`        | Roll a single service back one deploy (or to a specific deployment id with `--to`).                                                              |
| `rollback-commit` | Restore an env to the snapshot committed at a given git SHA.                                                                                     |
| `promote`         | Promote staging digests to production with prechecks.                                                                                            |
| `pin`             | Pin a service to a specific image digest.                                                                                                        |
| `env-diff`        | Diff two envs; exits 1 on drift.                                                                                                                 |
| `resolve-digest`  | Resolve an image tag (e.g. `:latest`) to its `sha256:` digest.                                                                                   |
| `lint-prod`       | CI gate (advisory): warn if any prod service is not digest-pinned. `--exit-zero` for advisory mode, `--format json` for machine-readable output. |

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

Docs production does not use `bin/railway promote --all`. Merge the `release/docs/prod` PR (pin file `showcase/pins/docs-prod.json`). Emergency only: `showcase/bin/railway promote docs --yes`.

### Landing a docs release

The bot opens one candidate after a green docs staging probe and leaves it
unchanged while the PR is open. Later builds do not push new pins over approvals.
To replace an unmerged candidate, close its PR and dispatch **Docs: open prod
release PR** on `main`. After a merge, the next Verify Deploy completion (or a
manual dispatch) can propose the next staging digest.

1. Inspect the digest in `showcase/pins/docs-prod.json` and the staging page.
   The pin's `git_sha` is the verification trigger SHA, which can be a
   scripts-only commit; it is not guaranteed to be the image's source revision.
   The immutable digest is the release identity. Staging can advance during
   review, so its current page may no longer represent the pinned candidate.
2. Update the release branch from `main` if GitHub requires it. Obtain approval
   **after** that update: the current rules require one approval, dismiss stale
   approvals, require approval of the last push, and require an up-to-date branch
   with passing checks. Further manual pushes can require reapproval.
3. Merge once GitHub's merge box is green. The workflow checks out that exact
   merge commit and promotes its pin; it does not resolve a closed PR merge ref.

The extra-approval setting for unattributed changes applies to
[unattributed GitHub Copilot PRs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#additional-approval-for-unattributed-copilot-pull-requests),
not all app-authored commits. This workflow uses the devops-bot GitHub App, not
Copilot, so that setting alone does not require a second reviewer. Always use
GitHub's current merge requirements as the authority; no rule bypass is enabled.

Promotion deliberately uses `--digest`: it skips P2's in-flight race check and
the staging-drift signal so it can ship the reviewed candidate even after staging
advances. P1 (digest exists in GHCR) and P3 (staging live-green) still run. This is
review-gated delivery, not automatic production deployment.

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

### Visibility surfaces

Two human-facing surfaces render the audit result every run:

1. **Workflow step summary** — the workflow writes a structured markdown
   block to `$GITHUB_STEP_SUMMARY` so the audit shows at the top of every
   run page (every event: `pull_request`, `push`, `workflow_dispatch`).
2. **Sticky PR comment** — on `pull_request` events, the workflow posts (or
   updates) a single comment per PR. The comment is keyed by the HTML marker
   `<!-- lint-prod-sticky-comment -->` so re-runs update the same comment
   instead of creating duplicates.

Both surfaces show the same content: a one-line status, a table of the
unpinned services (only — `pinned` services are not enumerated), and a
Pacific-time run timestamp with the finding count.

### Machine-readable output

`lint-prod --format json` emits:

```json
{
  "services": [
    { "name": "...", "source": "...", "status": "pinned|mutable-tag" }
  ],
  "findings": 3,
  "timestamp": "2026-05-27T18:00:00Z"
}
```

The CI workflow uses this shape to render the step summary and PR comment.
The `findings` count is also written to `$GITHUB_OUTPUT` so downstream jobs
(e.g. a future Slack alert step) can compare against prior runs.

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
