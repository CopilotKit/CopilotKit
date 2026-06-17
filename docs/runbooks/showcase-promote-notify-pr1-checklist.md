# PR1: Showcase Promote Notify Workflow — Pre-Merge Checklist

This runbook covers the steps required before merging the PR that introduces `.github/workflows/showcase_promote_notify.yml`.

## 1. Verify SLACK_BOT_TOKEN secret exists

- Go to https://github.com/CopilotKit/CopilotKit/settings/secrets/actions
- Confirm `SLACK_BOT_TOKEN` is set at org level (or repo level as fallback)
- Confirm the bot has scopes: `chat:write`, `chat:write.public`, `users:read.email`

## 2. Verify Slack bot channel membership

- The bot identity for `SLACK_BOT_TOKEN` must be a member of `#team-showcase` AND `#oss-alerts`
- OR confirm both channels are public AND the bot's `chat:write.public` scope is sufficient
- Verify via: `curl -X POST https://slack.com/api/conversations.list -H "Authorization: Bearer <token>" -d "types=public_channel,private_channel"`

## 3. Validate workflow end-to-end on PR branch (before merge)

For each of the three canonical fixtures:

> `run_id` MUST match `^[0-9a-f]{6}$` (6-char lowercase hex). The notify workflow's `run-name` interpolates this value; the CLI polls `gh run list` by `display_title == promote-<run_id>`, so a malformed value breaks the polling contract.

```bash
# Encode the fixture
RESULTS_B64=$(base64 < showcase/test-fixtures/promote-notify/success.json | tr -d '\n')

# Dispatch the workflow against the PR branch
gh workflow run -R CopilotKit/CopilotKit showcase_promote_notify.yml \
  --ref <pr-branch-name> \
  -f results="$RESULTS_B64" \
  -f trigger=cli \
  -f run_id=aaaa01

# Watch for completion
gh run list -R CopilotKit/CopilotKit --workflow=showcase_promote_notify.yml --limit 1
gh run watch -R CopilotKit/CopilotKit <run-id>
```

Repeat with `partial.json` (`run_id=aaaa02`) and `total-failure.json` (`run_id=aaaa03`).

## 4. Visual verification in Slack

- `#team-showcase`: confirm initiation post appears with operator mention, trigger, run_id, pre_staging line
- `#team-showcase`: confirm thread reply (in-thread, no broadcast) for each variant
- `#oss-alerts`: confirm cross-post appears ONLY for partial.json and total-failure.json (NOT success.json), with permalink back to #team-showcase

## 5. Verify schema_version guard

```bash
# Modify a fixture to have schema_version: 99
jq '.schema_version = 99' showcase/test-fixtures/promote-notify/success.json | base64 | tr -d '\n' > /tmp/bad-schema.b64
gh workflow run -R CopilotKit/CopilotKit showcase_promote_notify.yml \
  --ref <pr-branch-name> \
  -f results="$(cat /tmp/bad-schema.b64)" \
  -f trigger=cli \
  -f run_id=aaaa04
```

Verify the run logs `::warning::schema_version mismatch — expected 1, got '99'; aborting Slack post gracefully` (note the single-quotes around the value and the `::warning::` annotation prefix) and makes NO Slack API calls.

The run exits 0 (success). Green CI status does NOT mean Slack was notified; verify the warning annotation in the log to confirm the schema-mismatch abort path fired.

## 6. Merge

Once all five steps pass, admin-merge the PR. PR2 (CLI changes + workflow simplification) cannot land until this PR is on `main`.
