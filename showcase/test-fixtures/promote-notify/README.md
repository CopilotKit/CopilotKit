# promote-notify fixtures

Canonical input payloads for the `showcase_promote_notify.yml` GitHub Actions
workflow. These fixtures are used by:

- The workflow's contract test (the JSON-decode steps run against each fixture
  to validate schema handling without a live Slack call).
- Manual end-to-end validation during PR1 pre-merge sign-off (see
  `docs/runbooks/showcase-promote-notify-pr1-checklist.md`).

Each fixture conforms to the **Results JSON Schema** documented in the
promote-notify spec — `schema_version: 1`, `run_id`, `trigger`,
`operator_email`, `operator_git_name`, `started_at`, `elapsed_seconds`,
`pre_staging`, `abort_reason`, `succeeded`, `failed`.

## Outcome variants

All operator-visible counts in Slack messages (initiation header, partial/total
thread reply, `#oss-alerts` cross-post) use `failed_real_count` — the raw
`.failed` length minus any `truncation-suffix` sentinels. The raw `failed_count`
field is used only for internal logging. This keeps the header service total
and the thread/oss-alerts counts internally consistent when a truncation
sentinel is present.

| File                 | Outcome                                                                                                                  | `succeeded` | `failed`                              | `pre_staging` | `abort_reason`    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------- | ------------- | ----------------- |
| `success.json`       | All-green promote                                                                                                        | 28 services | 0                                     | `green`       | `null`            |
| `partial.json`       | Mixed result, 3 services failed with diverse failure categories (`staging-divergence`, `verify-prod-timeout`, `sigkill`) | 25 services | 3                                     | `amber`       | `null`            |
| `total-failure.json` | Fleet-wide preflight abort, no services attempted                                                                        | 0 services  | 28 services (all `staging-probe-red`) | `red`         | `fleet-preflight` |

> `abort_reason` is meaningful only on `outcome=total` (zero succeeded); the validator enforces this invariant via `assert_outcome_consistency`.

## Manual end-to-end dispatch

Each fixture can be base64-encoded and dispatched against the notify workflow
on any branch. The dispatch command pattern:

> `run_id` MUST match `^[0-9a-f]{6}$` (6-char lowercase hex). The notify workflow's `run-name` interpolates this value; the CLI polls `gh run list` by `display_title == promote-<run_id>`, so a malformed value breaks the polling contract.

```bash
gh workflow run -R CopilotKit/CopilotKit showcase_promote_notify.yml \
  --ref <branch> \
  -f results="$(base64 < showcase/test-fixtures/promote-notify/success.json | tr -d '\n')" \
  -f trigger=cli \
  -f run_id=aaaa01
```

Repeat with `partial.json` and `total-failure.json` to exercise all three
templates. Expected behavior:

- `success.json` posts an initiation message + all-green thread reply to
  `#team-showcase`. **No** `#oss-alerts` cross-post.
- `partial.json` posts initiation + partial-failure thread reply to
  `#team-showcase`, **plus** a one-line cross-post to `#oss-alerts` linking
  back to the thread.
- `total-failure.json` posts initiation + total-failure thread reply (with
  `pre_staging` and `abort_reason` rendered) to `#team-showcase`, **plus** a
  one-line cross-post to `#oss-alerts`.

## Regenerating fixtures from a real promote run

Once PR2 ships the CLI changes (`--all --notify --json`), a real fixture can
be captured directly from the local CLI:

```bash
# Capture a real fleet promote's results JSON
bin/railway promote --all --notify --json | tee real-results.json

# Pretty-print and prune to confirm it matches the schema
jq . real-results.json
```

Until PR2 is on `main`, the fixtures here are hand-crafted to exercise the
schema's edge cases. The handwritten fixtures should remain the canonical
contract-test inputs even after PR2 ships, because they're deterministic and
include cases (e.g. `staging-probe-red` across all 28 services) that are
inconvenient to reproduce live.

## Validation

`validate.sh` JSON-validates all three fixtures against the schema. Run it
after editing any fixture:

```bash
./showcase/test-fixtures/promote-notify/validate.sh
```

Exits 0 only when all three fixtures pass; exits non-zero with a `FAIL` line
naming the offending file and field on any violation. Requires `jq`.
