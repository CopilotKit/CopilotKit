# issue-triage

A maintainer-invoked GitHub bot that investigates issues with Claude Code, running inside a
TanStack AI local-process sandbox with our private `internal-skills` mounted read-only.

Triggered by commenting on an issue in `CopilotKit/CopilotKit`:

## `/triage`

Read-only investigation. The agent may read code, grep, and run read-only commands, but never
edits the checked-out tree. It:

1. Posts a comment on the issue with:
   - suspected root cause (with file:line evidence)
   - whether the issue is reproducible, and how
   - a proposed resolution, if actionable
2. Applies labels resolved from the agent's own assessment (drawn from a curated vocabulary:
   `bug`, `needs-repro`, `not-reproducible`, `question`, `documentation`, `enhancement`, plus
   `area:*` / `severity:*` prefixes).

Add `--deep` (`/triage --deep`) to use the larger model for a more thorough pass.

## `/fix`

Investigation + code edits. The agent may edit files and add/adjust tests, but does not run
`git` or open a PR itself. Once the agent finishes:

- If it made no changes, the orchestrator posts a comment saying so (with the agent's write-up).
- If it made changes, the orchestrator commits them, pushes a branch, and opens a PR whose body
  includes `Closes #<issue>` and the agent's summary, noting it should be reviewed before merge.

## Maintainer gate

Both commands are gated in the workflow to commenters whose `author_association` is one of
`OWNER`, `MEMBER`, or `COLLABORATOR`. Comments from anyone else (or on PRs, or without a
recognized command) are ignored.

## Secrets

The workflow requires:

- `ANTHROPIC_API_KEY` — used by the Claude Code agent.
- `TRIAGE_APP_ID` / `TRIAGE_APP_PRIVATE_KEY` — used to mint a GitHub App installation token for
  side-effects (comments, labels, branch push, PR creation).

The GitHub App backing `TRIAGE_APP_ID` must be installed on **both**:

- `CopilotKit` (write access — comments, labels, contents, pull requests)
- `internal-skills` (read access — cloned into the sandbox at
  `/tmp/triage-skills/internal-skills` so the agent can follow our internal skills)

## Local dry-run

Run the orchestrator directly with `DRY_RUN=true` to see what it _would_ do without posting a
comment, applying labels, or opening a PR:

```bash
COMMAND=triage \
REPO=CopilotKit/CopilotKit \
ISSUE_NUMBER=1234 \
ISSUE_TITLE="Some issue title" \
ISSUE_BODY="Some issue body" \
SOURCE_PATH=$(pwd) \
GH_TOKEN=$(gh auth token) \
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
DRY_RUN=true \
pnpm --filter @copilotkit/issue-triage triage
```

Expected for `/triage`: a streamed investigation, a sane comment body, resolved labels printed
to stdout, and a clean `git status` (triage should never edit the tree).

For `/fix`, set `COMMAND=fix` (and optionally `PRIOR_COMMENTS="..."` with prior triage findings).
Expected: either "would open PR" with a diff present, or a "no code changes" message — and
`internal-skills` cloned under `/tmp`, never inside the checked-out tree.

Other env vars the entrypoint reads: `DEEP` (`true` to use the larger model on `/triage`).
