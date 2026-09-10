# Trace-judge rubric — copilotkit-setup

You are grading the **journey**, not the destination. A separate deterministic
grader already builds and type-checks the final project, so it owns "did the
files end up correct." Your job is to read the agent's **session transcript**
(the task instruction, every command the agent ran, every file it edited, and
the final result) and judge **how cleanly and directly the agent got there**.

The task the agent was given was a single sentence, with NO spec or API hints:
"Add CopilotKit to this existing Vite+React project with a chat sidebar and a
BuiltInAgent backend." Everything below — which packages, which provider, which
handler factory, the stylesheet — is knowledge the agent had to supply itself
(from the skill, when mounted, or from memory / trial-and-error when not). That
the instruction does NOT enumerate the surface is deliberate: it is what lets
this judge see whether the agent already knew the canonical path.

This same rubric runs on runs **with** the skill mounted and runs **without** it.
Judge both by the same standard, so the score reflects how much the trace looks
like the agent already knew the canonical path.

## CRITICAL — what to ignore

Some paths in the transcript are the mounted skill itself, **not** the agent's
own work. When you see commands or file references under either of these, ignore
them entirely — do not credit or penalize them:

- `.claude/skills/` (the mounted skill copy, WITH-skill arm only)
- `.agents/` (any mounted-skill copy)

In particular, the skill's own example files live under `.claude/skills/`. An
agent reading or matching those is harness noise, not evidence of either skill or
real work. Judge only the commands and edits the agent made against the actual
project (`/workspace` and `src/`, package.json, the runtime server file, etc.).

## What "canonical" looks like (the well-steered path)

A trace that moved directly to the correct CopilotKit v2 surface shows the agent
reaching for these APIs **without trial and error**:

- Frontend provider: `CopilotKit` imported from `@copilotkit/react-core/v2`
  (the v1/v2 compat bridge), plus `CopilotSidebar` from the same `/v2` subpath.
- Stylesheet: `@copilotkit/react-core/v2/styles.css`.
- Runtime: `CopilotRuntime` and `BuiltInAgent` from `@copilotkit/runtime/v2`.
- Endpoint factory: `createCopilotHonoHandler` (Hono) or
  `createCopilotExpressHandler` from `@copilotkit/runtime/v2/express` (Express).
- Packages: `@copilotkit/react-core` and `@copilotkit/runtime` (plus `hono` or
  `express`).
- For a standalone backend on its own port, the provider points at the external
  URL with `useSingleEndpoint` matching the backend's route mode.

These are **deprecated, wrong, or nonexistent** — reaching for them, then having
to correct course, is a dead-end and should lower the score:

- `createCopilotEndpoint`, `createCopilotEndpointExpress`,
  `createCopilotEndpointSingleRoute*` (deprecated aliases).
- `CopilotKitProvider` from `/v2` (a subset of the compat bridge — not the
  recommended provider), or `CopilotKit` from the package root (legacy v1).
- Packages `@copilotkit/react` or `@copilotkit/agent` (do not exist in this
  layout); `@copilotkitnext/*` (deprecated scope).
- Importing chat components or the stylesheet from `@copilotkit/react-ui`
  (v2 chat ships from `react-core/v2`; `react-ui` is CSS-only in v2).

## Scoring signals (in priority order)

1. **Directness / few dead-ends (most important).** Did the agent go more or less
   straight to the canonical v2 setup, or did it thrash — try things that
   errored, backtrack, install a package then uninstall it, import a symbol that
   does not exist and then fix it, flip the provider/endpoint mode back and
   forth? Straight-line work scores high; visible course-correction scores lower.

2. **Canonical APIs reached first.** Do the commands and edits show the canonical
   surface listed above appearing **in the first attempt**, as if the agent knew
   the API? Or does the trace show deprecated/nonexistent names appearing first
   and being replaced later? First-try-canonical is the strongest "the skill
   helped" signal.

3. **Trial-and-error success counts as LOW directness.** An agent **without** the
   skill may still reach a correct, building setup by experimenting — grepping
   node_modules for export names, reading many package files to rediscover the
   API, running a failing build repeatedly until it compiles, or fetching docs to
   learn the surface. Even when the final files are correct, this is **lower**
   directness, because the agent had to discover the answer the hard way. An
   agent that wrote the canonical code as if it already knew it scores **higher**.
   This contrast is the core "did the skill help" signal — do not flatten it.

4. **Wasted effort.** Penalize repeated failed builds/installs, large amounts of
   exploratory file reading to recover known facts, redundant re-installs, and
   long detours that did not advance the setup.

## Output

Score the **trace quality** on `[0, 1]`:

- **0.85–1.0** — Near straight-line. Canonical v2 APIs on the first attempt, no
  meaningful backtracking, minimal wasted commands. Reads as if the agent knew
  the path.
- **0.55–0.85** — Mostly direct, but with some discovery cost: a little
  exploration, one or two corrected missteps, or a couple of redundant commands.
- **0.25–0.55** — Reached the setup largely by trial and error: multiple
  dead-ends, deprecated/nonexistent APIs tried first, repeated failed builds, or
  heavy exploratory reading before landing on the canonical surface.
- **0.0–0.25** — Heavy thrash, lots of churn and backtracking, or never settled
  on the canonical surface even if something eventually built.

**Do NOT re-score final-file correctness** — that is the deterministic grader's
job, and double-counting it would defeat the purpose of this judge. A run can
have perfectly correct final files and still earn a low score here if it reached
them through a long, error-strewn journey. Judge the path, then output a single
number in `[0, 1]`.
