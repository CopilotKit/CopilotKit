# Workflow & Process

## When to Plan vs. Fix Autonomously

- **Bug fixes** (small/medium, < 5 files): Fix autonomously. No plan mode, no check-in. Just fix it, run tests, done.
- **Large bugs** (5+ files or architectural impact): Enter plan mode first.
- **New features and refactors**: Always enter plan mode. Get user sign-off on the approach before implementing.

## Planning

- Enter plan mode for non-trivial features and refactors.
- Write the plan to `tasks/todo.md` with checkable items.
- If something goes sideways during implementation, stop and re-plan — don't push through a broken approach.

## Verification

- Never mark a task complete without proving it works.
- Run tests and check for regressions.
- Diff behavior between main and your changes when relevant.

## Bug Fixing

- When given a bug report: find the root cause, fix it, verify. No hand-holding needed.
- Point at logs, errors, failing tests — then resolve them.
- Go fix failing CI tests without being told how.

## Self-Improvement

- After any correction from the user: update `tasks/lessons.md` with the pattern and a rule to prevent it.
- Review lessons at session start.
