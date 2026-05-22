# Contribution Guide

## Prerequisites

- **Node.js** 20.x or later
- **pnpm** v9.x installed globally: `npm i -g pnpm@^9`
- **Git** configured with your GitHub account
- **Windows users:** Enable Developer Mode (Settings > System > For developers) for symlink support

## Fork and Clone

1. Fork [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit) on GitHub.
2. Clone your fork:

```bash
git clone https://github.com/<your-username>/CopilotKit.git
cd CopilotKit
```

3. Add the upstream remote:

```bash
git remote add upstream https://github.com/CopilotKit/CopilotKit.git
```

4. Keep your fork up to date:

```bash
git fetch upstream
git rebase upstream/main
```

## Initial Setup

```bash
# Install all dependencies
pnpm install

# Build all packages (required before first dev session)
pnpm build
```

The build step is necessary because packages depend on each other. Nx handles the dependency graph — `pnpm build` runs `nx run-many -t build --projects=packages/**` with correct ordering.

## Branch Naming

Use a group prefix with the issue number:

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/<ISSUE>-<name>` | `feat/1234-add-voice-hook` |
| Bug fix | `fix/<ISSUE>-<name>` | `fix/5678-runtime-cors` |
| Documentation | `docs/<ISSUE>-<name>` | `docs/9012-api-reference` |

```bash
git checkout -b feat/1234-my-feature
```

## Development

Start all packages in watch/dev mode:

```bash
# All packages
pnpm dev

# V2 packages only
pnpm dev:next

# V1 packages only (if working on v1 wrappers)
pnpm dev:classic

# Single package
nx run @copilotkit/core:dev
```

## Commit Message Format

CopilotKit enforces [conventional commits](https://www.conventionalcommits.org/) via commitlint (runs as a `commit-msg` hook through lefthook). The format is:

```
<type>(<scope>): <subject>
```

**Header max length:** 120 characters.

### Types

| Type | Description |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `style` | Formatting, whitespace (no code logic change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `chore` | Build process, tooling, dependencies |

### Scope

Use the package name without the namespace prefix:

```
fix(runtime): handle missing agent on init
feat(react): add useInterrupt hook
test(core): cover edge case in tool registry
```

## Pre-commit Hooks

CopilotKit uses [lefthook](https://github.com/evilmartians/lefthook) for git hooks. On every commit, the following run in parallel:

1. **check-binaries** — rejects binary files, build artifacts, oversized files (>1MB)
2. **sync-lockfile** — runs `pnpm i --lockfile-only` if package.json changed
3. **lint-fix** — runs `pnpm run lint --fix && pnpm run format`
4. **test-and-check-packages** — runs `pnpm run test && pnpm run check:packages`

If hooks fail, fix the issue and commit again. Do not skip hooks with `--no-verify`.

## Submitting a Pull Request

1. Push your branch to your fork:

```bash
git push origin feat/1234-my-feature
```

2. Open a PR against the `main` branch of CopilotKit/CopilotKit.
3. Fill in the PR template with:
   - Description of the changes
   - Related issue number
   - Any questions or known limitations
4. Wait for CI to pass and a maintainer to review.
5. Address review feedback with additional commits.

## Communication

- **Before starting significant work:** File an [issue](https://github.com/CopilotKit/CopilotKit/issues) or reach out on [Discord](https://discord.com/invite/6dffbvGU3D).
- **Questions:** Use the [Discord support channel](https://discord.com/invite/6dffbvGU3D).
- **Documentation:** Visit [docs.copilotkit.ai](https://docs.copilotkit.ai/).
