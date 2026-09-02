# Contributing to CopilotKit for Angular

Thank you for helping improve `@copilotkit/angular`. Read the repository-level [contribution guide](../../CONTRIBUTING.md) first for the general fork, branch, commit, and pull request workflow.

## Contribution flow: issue, decision, pull request

1. **Open an issue before implementation.** Describe the use case, reproduction or proposed API, alternatives, and framework parity to React where relevant. For bugs, include the CopilotKit, Angular, browser, Node.js, and package manager versions.
2. **Wait for the maintainers' decision.** Maintainers will agree on the approach and decide whether the implementation belongs to a community contributor or not. Do not start implementation or open a pull request until you receive an explicit go-ahead.
3. **Open a linked pull request.** Once the approach is agreed, the designated implementer opens a PR linked to the approved issue.

We want as many contributions as possible to be implemented by the community. Maintainers will very likely implement changes that reach deeply into internal architecture, whose implementation is too large or differs substantially from the proposed issue.

When the team implements a community issue, we will credit the issue author in the PR and add them as a co-author whenever possible, especially when their reproduction, research, or design input shapes the solution.

Search existing [issues](https://github.com/CopilotKit/CopilotKit/issues) and pull requests first. Use [GitHub Discussions](https://github.com/CopilotKit/CopilotKit/discussions) or [Discord](https://discord.gg/6dffbvGU3D) for support questions.

## Setup and development

Run tasks through Nx from the repository root:

```bash
pnpm install
pnpm exec nx run @copilotkit/angular:build
pnpm exec nx run @copilotkit/angular:test
pnpm exec nx run @copilotkit/angular:check-types

# Run one spec while iterating
pnpm exec nx run @copilotkit/angular:test -- src/lib/agent-context.spec.ts
```

The supported Angular, CDK, TypeScript, and RxJS versions are defined in `copilotkit.angularSupport` in [`package.json`](./package.json). Do not change that contract without validating the supported consumer matrix.

For visible UI changes, exercise the Angular demo or Storybook:

```bash
pnpm exec nx run-many -t dev --projects=@copilotkit/angular-demo,@copilotkit/angular-demo-server
pnpm exec nx run @copilotkit-storybook/angular:dev
```

## Angular implementation and tests

Use Angular's official [`angular-developer` Agent Skill](https://angular.dev/ai/agent-skills) for Angular-specific implementation guidance. Every bug fix and feature requires a focused regression test.

## Public APIs

When changing a public export:

1. Update `src/public-api.ts` or `src/mcp-apps/index.ts`.
2. Update the matching section in `API.md`; every public export must appear exactly once.
3. Update the README, documentation, examples, or Storybook as needed.
4. Consider SSR, zoneless applications, and framework parity.

Do not edit package versions or `CHANGELOG.md`, and do not add a changeset.

## Before submitting

Run the complete Angular package verification for code changes:

```bash
pnpm verify:angular-package
```

This covers build, types, tests, package validation, and a strict packed Angular consumer. For documentation-only changes, run:

```bash
pnpm exec nx format:check --files=packages/angular/CONTRIBUTING.md,packages/angular/README.md
```

In the PR, link the approved issue, explain the motivation, list the exact Nx commands run, and include screenshots or recordings for visible changes.
