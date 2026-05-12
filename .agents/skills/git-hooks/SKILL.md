---
name: git-hooks
description: CopilotKit pre-commit hook reference. Load automatically when the user mentions git hooks failing, pre-commit errors, lefthook issues, commit blocked, or "hooks don't work", or when user wants to commit/push anything Contains the full hook topology so debugging skips discovery and goes straight to diagnosis.
---

# CopilotKit Git Hooks Reference

## Hook runner: Lefthook

The repo uses **lefthook** (not husky). The git hook at `.git/hooks/pre-commit` calls lefthook, which reads `lefthook.yml` at the repo root.

Config file: `lefthook.yml`

## Pre-commit commands (run in parallel)

```
sync-lockfile          lint-fix          test-and-check-packages
```

### 1. `sync-lockfile`

- **Trigger**: only when `**/package.json` files are staged
- **Command**: `pnpm i --lockfile-only`
- **`stage_fixed: true`**: auto-stages the updated lockfile
- **Fails if**: pnpm can't resolve dependencies

### 2. `lint-fix`

- **Command**: `pnpm run lint --fix && pnpm run format`
- Expands to: `nx run-many -t lint --projects=packages/**` then `prettier --write "**/*.{ts,tsx,md}"`
- **`stage_fixed: true`**: auto-stages any files it fixes
- **Fails if**: lint errors that `--fix` can't auto-correct

### 3. `test-and-check-packages` ← most common failure

- **Command**: `pnpm run test && pnpm run check:packages`
- Expands to:
  1. `nx run-many -t test` — runs all unit tests across all packages
  2. `nx run-many -t publint,attw --projects=packages/**` — checks package exports and types are correctly declared
- **`stage_fixed: false`** — does NOT auto-stage anything
- **Env**: `NX_TUI: "false"` (plain output, no interactive UI)
- **Fails if**:
  - Any test fails
  - `publint` finds malformed `package.json` exports
  - `attw` (Are the Types Wrong?) finds type declaration issues

## Diagnosing a failure

The summary shows a boxing glove 🥊 for the failing command.
The error itself does not show directly.
To see the actual error:

```bash
# Run only the failing command manually:
pnpm run test                          # if test-and-check-packages failed
pnpm run check:packages                # isolate publint/attw from test failures
nx run-many -t test --projects=<pkg>  # narrow to a specific package

# Re-run lefthook manually (without committing):
pnpm lefthook run pre-commit
```

## npm scripts involved

| Script                    | Expands to                                           |
| ------------------------- | ---------------------------------------------------- |
| `pnpm run lint`           | `nx run-many -t lint --projects=packages/**`         |
| `pnpm run format`         | `prettier --write "**/*.{ts,tsx,md}"`                |
| `pnpm run test`           | `nx run-many -t test`                                |
| `pnpm run check:packages` | `nx run-many -t publint,attw --projects=packages/**` |
