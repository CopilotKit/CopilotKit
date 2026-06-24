# Skill evals

Automated evaluations for the skills under `skills/`, run with
[skillgrade](https://github.com/mgechev/skillgrade) (pinned `0.1.5`).

Each skill that has an eval gets its own directory here:
`skill-evals/<skill-name>/`. Eval config and fixtures live here, **not** inside
`skills/<name>/`, because `npx copilotkit skills install` copies entire skill
directories into user projects. Harness files must never ship to users; the
`skill:` field in each `eval.yaml` points skillgrade back at the skill under test.

## What an eval measures: skill _lift_

A capable agent usually reaches a correct answer eventually, with or without the
skill. So absolute "did it end correct" mostly measures the _agent_, not the
_skill_. What we actually want is **lift**: does the skill get the agent there
_better_ — faster, fewer commands, fewer tokens, fewer dead-ends — and does the
agent actually _use_ the skill's guidance?

That makes the real experiment **comparative**: run the same task twice, once with
the skill mounted and once without, and diff the results. Two signals matter:

1. **Headline — efficiency lift.** Δ in wall-clock `duration`, command count, and
   tokens between the with-skill and without-skill runs, at equal success.
2. **Gate — correctness.** The project must actually build / type-check. The
   deterministic grader _runs the project_, it does not grep for API names: a
   capable agent reaches the right APIs either way, so grepping measures the agent.
3. **Judge — did the skill help.** An `llm_rubric` grader reads the agent's session
   transcript (instruction + every command + result) and judges whether the agent
   leaned on the skill or floundered. This is the closest automatable proxy for
   "did the skill's information help its reasoning."

## Layout of a skill eval

```
skill-evals/<skill>/
  eval.yaml          # skillgrade config: agent, docker, task(s), graders
  workspace/<name>/  # the STARTING fixture the agent is dropped into
  graders/check.sh   # deterministic correctness grader (referenced by eval.yaml)
  rubric.md          # trace-judge rubric (referenced by eval.yaml)
  lift/run.mjs       # runs the with/without-skill comparison and reports lift
  results/           # gitignored run outputs (ephemeral today; see "Tracking")
```

`eval.yaml` uses skillgrade's **file-reference** feature: when a `run:` or
`rubric:` value is a path, skillgrade reads that file's contents. That keeps the
grader scripts and rubric as real, lintable, diffable files instead of inline YAML
blobs — and it is the seam we will factor a shared grader harness through when a
second skill eval lands (do not pre-abstract from one example).

## The grader contract

Every deterministic grader prints a single JSON object to stdout:

```json
{
  "score": 0.0,
  "details": "human-readable summary",
  "checks": [{ "name": "build succeeds", "passed": true, "message": "..." }]
}
```

`score` is in `[0, 1]`. Graders run in the post-agent container (`node:20-slim`
plus whatever `docker.setup` installs — currently `git` and `jq`; there is **no
`bc`**, so use `awk` for score math). The skill itself is mounted into the
container at `/workspace/.agents/skills` and `/workspace/.claude/skills`, so any
source scan MUST exclude those paths (`--exclude-dir=.agents --exclude-dir=.claude`)
or a no-op agent scores points by matching the skill's own example files.

## The lift results contract

`lift/run.mjs` writes one JSON file per run into `results/` shaped like:

```json
{
  "timestamp": "ISO-8601",
  "skill": "copilotkit-setup",
  "trials": 5,
  "withSkill": {
    "passRate": 0.0,
    "meanReward": 0.0,
    "medianDurationMs": 0,
    "medianCommands": 0,
    "medianTokens": 0
  },
  "withoutSkill": {
    "passRate": 0.0,
    "meanReward": 0.0,
    "medianDurationMs": 0,
    "medianCommands": 0,
    "medianTokens": 0
  },
  "lift": { "passRate": 0.0, "durationMs": 0, "commands": 0, "tokens": 0 }
}
```

`lift.*` is `withSkill - withoutSkill` (so a _negative_ `durationMs`/`commands`/
`tokens` lift is good — the skill made the agent faster/leaner; a _positive_
`passRate` lift is good). The script also prints a human-readable table.

## Running

```bash
# Full lift comparison (Docker + an LLM key for the rubric grader):
pnpm eval:skill:setup

# Quick single raw run while iterating on graders/fixtures:
cd skill-evals/copilotkit-setup && pnpm exec skillgrade --trials=1
```

Auth: put a `.env` next to the skill's `eval.yaml` (gitignored). The **agent**
(Claude Code) runs key-free on your subscription via `CLAUDE_CODE_OAUTH_TOKEN`,
or on `ANTHROPIC_API_KEY` (Console billing).

> **Capture the OAuth token carefully.** `claude setup-token` is an interactive
> TUI. Run it on its own, then **copy the printed `sk-ant-oat...` value** into the
> `.env`. Do **NOT** do `CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token)` — command
> substitution captures the TUI's terminal escape codes instead of the token,
> producing an opaque in-container `API Error 400`. (`lift/run.mjs` now preflights
> the token shape and rejects this, but it is still the easiest way to footgun it.)
>
> ```bash
> claude setup-token   # complete the browser flow, copy the sk-ant-oat... value
> echo 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat...' > skill-evals/copilotkit-setup/.env
> ```

The two grader paths:

- **Subscription / OAuth only** — fully key-free. `lift/run.mjs` detects this and
  runs **deterministic-only** automatically (`--grader=deterministic` on both
  arms): you keep the build/type-check gate and the duration/commands/tokens lift,
  and the `llm_rubric` trace judge is skipped. (The rubric grader calls the
  messages API directly, which OAuth tokens cannot do — so it can't run on a
  subscription.)
- **`ANTHROPIC_API_KEY` present** — the trace judge runs too, for the full signal.

## Tracking (today vs. later)

Today the eval is **on-demand and ephemeral**: you run it when you suspect a
regression and read the lift numbers; `results/` is gitignored. The results JSON
shape above is deliberately stable so that "flip to committed history" (commit
`results/` for a `git log` trend line) and eventually a cron/nightly job are
additive, not rewrites. No CI gate yet — each run spins containers and burns agent
tokens.
