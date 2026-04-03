# Pull Request Guidelines

## Before You Start

Reach out to the maintainers before starting any significant work on new or existing features. File an issue or ask on [Discord](https://discord.com/invite/6dffbvGU3D). This prevents wasted effort on work that doesn't align with the project direction or is already in progress.

## PR Checklist

Before opening a PR, verify all of these pass locally:

1. **Tests pass:** `pnpm run test`
2. **Build succeeds:** `pnpm build`
3. **Formatting clean:** `pnpm run check-prettier`
4. **Lint clean:** `pnpm run lint`
5. **Package quality:** `pnpm run check:packages` (runs publint + attw)
6. **Commit messages valid:** all commits follow `<type>(<scope>): <subject>` format

## CI Pipeline

Every push and pull request triggers the CI workflow which:

1. Checks out the code
2. Installs pnpm and Node.js (version from `package.json`)
3. Runs `pnpm install`
4. Runs `pnpm run build` (builds all packages respecting Nx dependency graph)
5. Publishes preview packages via [pkg-pr-new](https://github.com/stackblitz-labs/pkg.pr.new) for every commit

Preview packages are published from both `packages/v1/*` and `packages/v2/*`, allowing reviewers and users to test your changes before merge.

## Pre-commit Hooks

CopilotKit uses [lefthook](https://github.com/evilmartians/lefthook) to run pre-commit and commit-msg hooks automatically:

### Pre-commit (parallel)

| Hook | What it does |
|---|---|
| `check-binaries` | Rejects binary files, build artifacts, dSYM dirs, and files >1MB |
| `sync-lockfile` | Runs `pnpm i --lockfile-only` when package.json changes, auto-stages |
| `lint-fix` | Runs `pnpm run lint --fix && pnpm run format`, auto-stages fixes |
| `test-and-check-packages` | Runs `pnpm run test && pnpm run check:packages` |

### Commit-msg

| Hook | What it does |
|---|---|
| `commitlint` | Validates commit message against conventional commit format |

If hooks fail, fix the issue and try again. Do not use `--no-verify` to bypass hooks.

## Commit Message Format

Enforced by commitlint with `@commitlint/config-conventional`:

```
<type>(<scope>): <subject>
```

- **Header max length:** 120 characters
- **Subject case:** not enforced (rule disabled)

### Valid types

`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

### Scope

Use the package directory name: `runtime`, `core`, `react`, `angular`, `react-core`, `react-ui`, `shared`, `agent`, etc.

### Examples

```
feat(react): add useInterrupt hook for agent interrupts
fix(runtime): handle missing agent ID in request middleware
test(core): cover tool registry edge cases
docs(shared): update type documentation for EventType
chore(deps): bump vitest to 3.x
```

## PR Description

Include in your PR:

1. **What changed** — brief description of the changes
2. **Why** — the motivation or issue being addressed
3. **Issue reference** — link to the related GitHub issue (e.g., `Fixes #1234`)
4. **Testing** — how you verified the changes work
5. **Known limitations** — anything the reviewer should be aware of

## Review Process

1. A maintainer will review your PR.
2. CI must pass before review begins.
3. Reviewers may request changes — address feedback with additional commits.
4. Once approved and CI is green, a maintainer will merge the PR.

## Tips

- **Keep PRs focused.** One feature or fix per PR. Smaller PRs get reviewed faster.
- **Update tests.** If you change behavior, update or add tests to cover it.
- **Don't mix refactoring with features.** If you need to refactor something to enable your feature, submit the refactor as a separate PR first.
- **Rebase on main** before submitting if your branch is behind. Stale lockfiles are a common CI failure cause.
- **V2 first.** New features go in `packages/v2/`. Only add V1 wrappers if backward compatibility is needed.
