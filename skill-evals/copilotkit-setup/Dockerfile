# Eval container for the copilotkit-setup skill-lift harness (see lift/run.ts).
#
# One image, built once, run as N fresh containers per arm. The fixture is baked
# at /workspace so every container starts from a pristine copy. The skill is NOT
# baked in here — lift/run.ts `docker cp`s it into /workspace/.claude/skills for
# the WITH-skill arm only. That single difference (skill dir present vs absent) IS
# the entire with/without mechanism — no hacks, no second image.
#
# The grader and the task instruction live under /eval-tools (OUTSIDE /workspace)
# so the agent never sees them and a source scan can never pick them up.
FROM node:20-slim

# git: some installs / tooling expect it. The agent CLI is Claude Code. tsx runs
# the TypeScript grader (graders/check.ts) — the same runner the host harness uses.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code tsx

WORKDIR /workspace

# Bake the starting fixture and pre-install its base deps so the per-trial
# type-check gate does not pay a cold install for react/vite every time. The
# agent adds @copilotkit/* (and express/hono) on top; that install is incremental.
COPY workspace/vite-react/ /workspace/
RUN npm install

# Grader + instruction live outside the workspace the agent works in.
COPY graders/check.ts /eval-tools/check.ts
COPY instruction.md /eval-tools/instruction.md
