# Skill evals

Automated evaluations for the skills under `skills/`. Each skill that has an eval
gets its own directory here: `skill-evals/<skill-name>/`. Config, fixtures, the
grader, and the rubric live here, **not** inside `skills/<name>/`, because
`npx copilotkit skills install` copies entire skill directories into user
projects — harness files must never ship to users.

The harness is self-contained: a small TypeScript runner driving the `docker` CLI
and real Claude Code (`claude -p`). There is no third-party eval framework.

## What an eval measures: skill _lift_

A capable agent usually reaches a correct answer eventually, with or without the
skill. So absolute "did it end correct" mostly measures the _agent_, not the
_skill_. What we actually want is **lift**: does the skill get the agent there
_leaner_ — fewer turns, fewer tokens, less wall-clock, lower cost — at equal
success, and does it reach the canonical surface more directly?

That makes the real experiment **comparative**: run the same task twice, once with
the skill mounted and once without, and diff the results.

- **Headline — efficiency lift.** Δ in `num_turns`, `usage` tokens, `duration_ms`,
  and `total_cost_usd` between the with-skill and without-skill arms. These are
  **real** values read off `claude -p --output-format stream-json`'s result event,
  not estimates.
- **Gate — correctness.** The project must actually build / type-check. The
  deterministic grader _runs the project_ (`graders/check.ts`), it does not grep
  for API names as the gate: a capable agent reaches the right APIs either way, so
  grepping measures the agent.
- **Judge — did the skill help (optional).** When a judge key is present, an LLM
  reads the agent's stream-json transcript and scores how _directly_ it reached the
  canonical v2 surface (`rubric.md`). Trial-and-error success scores lower on
  directness — the "did the skill actually help" contrast.

## How with/without works

The single difference between the two arms is whether the skill directory exists
at `/workspace/.claude/skills/copilotkit-setup` inside the container — the path
Claude Code discovers project skills from in headless mode. The WITH arm
`docker cp`s the skill in; the WITHOUT arm does not. No flags, no hacks, no second
image.

## Layout of a skill eval

```
skill-evals/<skill>/
  Dockerfile          # node:20-slim + claude-code + tsx; bakes the fixture at /workspace
  instruction.md      # the task handed to the agent (baked at /eval-tools)
  workspace/<name>/   # the STARTING fixture the agent is dropped into
  graders/check.ts    # deterministic correctness grader (TypeScript, run via tsx)
  rubric.md           # optional trace-judge rubric
  lift/run.ts         # runs the with/without comparison and reports lift
  results/            # gitignored run outputs (ephemeral today; see "Tracking")
```

## The grader contract

`graders/check.ts` prints a single JSON object to stdout:

```json
{
  "score": 0.0,
  "details": "human-readable summary",
  "checks": [{ "name": "type-check: (root)", "passed": true, "message": "..." }]
}
```

`score` is in `[0, 1]`. It runs in the post-agent container via
`tsx /eval-tools/check.ts` (outside `/workspace`, so it is never graded as the
agent's own output). The WITH-skill arm mounts the skill into
`/workspace/.claude/skills`, so every source scan excludes `.claude` / `.agents` /
`node_modules` or a no-op agent would score points off the skill's own examples.

## The lift results contract

`lift/run.ts` writes one JSON file per run into `results/` shaped like:

```json
{
  "timestamp": "ISO-8601",
  "skill": "copilotkit-setup",
  "trials": 5,
  "rubricRan": false,
  "withSkill": {
    "passRate": 0.0,
    "meanReward": 0.0,
    "medianDurationMs": 0,
    "medianTurns": 0,
    "medianTokens": 0,
    "medianCostUsd": 0.0
  },
  "withoutSkill": {
    "passRate": 0.0,
    "meanReward": 0.0,
    "medianDurationMs": 0,
    "medianTurns": 0,
    "medianTokens": 0,
    "medianCostUsd": 0.0
  },
  "lift": {
    "passRate": 0.0,
    "durationMs": 0,
    "turns": 0,
    "tokens": 0,
    "costUsd": 0.0
  }
}
```

`lift.*` is `withSkill - withoutSkill` (so a _negative_ `durationMs` / `turns` /
`tokens` / `costUsd` lift is good — the skill made the agent leaner; a _positive_
`passRate` lift is good). The script also prints a human-readable table.

## Running

```bash
pnpm eval:skill:setup                 # full with/without lift comparison (needs Docker)
pnpm eval:skill:setup --trials=3      # fewer trials per arm (default 5)
pnpm eval:skill:setup --concurrency=2 # fewer containers/agent sessions at once (default 4)
```

Trials run in a bounded-concurrency pool (each is an independent container), so
the wall-clock is roughly the slowest wave, not the sum of all trials. Lower
`--concurrency` (or `SKILL_EVAL_CONCURRENCY`) if you hit the agent's API rate
limit on a subscription token or run low on RAM.

Auth — put a `.env` next to the eval (gitignored):

- **Agent (required).** `CLAUDE_CODE_OAUTH_TOKEN` (subscription, key-free) or
  `ANTHROPIC_API_KEY` (Console). Either runs Claude Code.
- **Judge (optional).** `OPENAI_API_KEY` (preferred when set) or
  `ANTHROPIC_API_KEY`. Absent → the run is deterministic-only and the trace judge
  is skipped. Defaults: OpenAI → `gpt-5.5`, Anthropic → `claude-haiku-4-5`. Override
  with `OPENAI_MODEL` / `ANTHROPIC_GRADER_MODEL`, or force a provider with
  `JUDGE_PROVIDER=openai|anthropic`. An OAuth subscription
  token alone **cannot** drive the judge (it can't call the messages/completions
  API), which is why the judge is optional.

> **Capture the OAuth token carefully.** `claude setup-token` is an interactive
> TUI. Run it on its own, then **copy the printed `sk-ant-oat...` value** into the
> `.env`. Do **NOT** do `CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token)` — command
> substitution captures the TUI's escape codes instead of the token, producing an
> opaque in-container `API Error 400`. (`lift/run.ts` preflights the token shape
> and rejects this, but it is still the easiest way to footgun it.)
>
> ```bash
> claude setup-token   # complete the browser flow, copy the sk-ant-oat... value
> echo 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat...' > skill-evals/copilotkit-setup/.env
> # optional judge:
> echo 'OPENAI_API_KEY=sk-...' >> skill-evals/copilotkit-setup/.env
> ```

## Scheduled runs (CI)

A GitHub Actions workflow runs the with/without comparison and posts the lift
table to the run's **Step Summary**, so you can skim the trend from the Actions
tab without downloading anything. See `.github/workflows/skill_eval-lift.yml`.

- **When.** Three triggers: a daily cron `0 14 * * *` (trials=3) for the trend
  line; a **pull_request** smoke run (trials=1) that fires **only** on PRs which
  touch `skill-evals/**`, `skills/copilotkit-setup/**`, or the workflow itself —
  it is a merge-blocking check for eval-relevant PRs, not a token tax on every
  PR; and `workflow_dispatch` for ad-hoc runs. Each run spins Docker containers
  and burns agent tokens, which is why the PR trigger is path-filtered.
- **Trials.** `--trials=3` on the daily run (6 agent sessions/arm-pair) balances
  noise vs. cost; PR smoke runs use `--trials=1` (validates the harness + agent
  completion + build, not statistical lift); the manual-dispatch form takes a
  `trials` input to override.
- **Auth.** The agent prefers the `CLAUDE_CODE_OAUTH_TOKEN` repo secret (a
  subscription seat, no per-call Console credits) and falls back to
  `ANTHROPIC_API_KEY` (a Console key, which draws on the org's prepaid credit
  balance — a depleted balance surfaces as `400: Credit balance is too low`). The
  judge uses `OPENAI_API_KEY` (an OAuth token cannot drive the judge API). If the
  OAuth secret ever expires, rotate it with a fresh `claude setup-token` value
  (see the footgun note below on capturing it cleanly).
- **Output.** When `GITHUB_STEP_SUMMARY` is set, `lift/run.ts` appends a markdown
  lift table there (same numbers as the terminal table). Scheduled Step Summaries
  live as long as the run's logs are retained.
- **Trying it before merge.** Scheduled workflows only fire from the default
  branch. To exercise the workflow on a feature branch, dispatch it explicitly:
  `gh workflow run skill_eval-lift.yml --ref <branch>`.

## Tracking (today vs. later)

Beyond the daily Step Summary, per-run JSON still lands in `results/` (gitignored,
ephemeral). The results JSON shape above is deliberately stable so that "flip to
committed history" (commit `results/` for a `git log` trend line), artifact
upload, or a regression Slack ping are additive, not rewrites.

## Adding a second skill eval

The grader, Dockerfile, and runner are deliberately self-contained for the first
skill. When a second eval lands, factor the shared pieces (the `docker` driver in
`run.ts`, the grader contract) into a small `skill-evals/_harness/` — do not
pre-abstract from one example.
