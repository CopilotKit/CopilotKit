# Fix a failing lint check

Run these two commands from the repo root:

```sh
pnpm lint
pnpm lint:dead-code
```

They run the same checks as the `oxlint` and `knip` jobs in CI. If both commands pass, those jobs pass too.

## Why your PR failed

The check fails when your change adds a lint error in `packages/` source. Old errors do not fail the check. They are recorded in a baseline file, and the check allows them.

The check looks for:

- `any` in a type
- an empty `catch {}` or `.catch(() => {})`
- a promise that nothing awaits, and other promise mistakes
- an `oxlint-disable` or `eslint-disable` comment with no reason
- a condition that is always true or always false (a dead branch)
- a file with more than 800 lines of code
- every rule in the oxlint `correctness` and `suspicious` categories, for example an unsafe `as` cast
- unused files, exports, types, enum members, duplicate exports, and dependencies (knip)

Tests are not checked. Code outside `packages/` keeps its warnings only.

## Fix a new error

The output names the file, the rule, and the first line that fails:

```text
1 new error(s) in 1 file(s), over the baseline:

packages/core/src/index.ts
  typescript-eslint(no-explicit-any): 1 (allowed 0)
    first: line 17: Unexpected `any`. Specify a different type.
```

1. Open the file at the line in the output.
2. Fix the code. Use the table below.
3. Run `pnpm lint` again.

To see every error in one file, run:

```sh
pnpm exec oxlint -c .oxlintrc.json --type-aware packages/core/src/index.ts
```

| Rule                                 | Fix                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `no-explicit-any`                    | Use the real type. If the type is not known, use `unknown` and narrow it.                                   |
| `no-floating-promises`               | Add `await`. If the call must not block, write `void promise` and handle errors inside the called function. |
| `no-misused-promises`                | Wrap the async call: `onClick={() => { void save(); }}`.                                                    |
| `copilotkit(no-swallowed-error)`     | Handle the error, or rethrow it. If ignoring it is safe, write a comment inside the handler that says why.  |
| `copilotkit(require-disable-reason)` | Add a reason after `--`, as shown below.                                                                    |
| `no-unnecessary-condition`           | Remove the dead branch. If the value can be missing at run time, fix the type so that it says so.           |
| `max-lines`                          | Move part of the file into a new module.                                                                    |
| `no-unsafe-type-assertion`           | Narrow the value with a check instead of `as`.                                                              |
| `knip(exports)`                      | Remove the unused export, or use it.                                                                        |

If you must turn off a rule for one line, give the reason after `--`:

```ts
// oxlint-disable-next-line typescript/no-explicit-any -- the SDK types this field as any
```

Do not edit `.lint-baseline/` by hand. Do not run `pnpm lint:baseline` to hide a new error.

## The check says the baseline is stale

You fixed old errors. The baseline still allows them, so the check fails until you record the fix.

1. Run `pnpm lint:prune` (or `pnpm lint:dead-code:prune` for knip).
2. Commit the smaller file in `.lint-baseline/`.

Prune only lowers counts. It never allows a new error.

## The pre-commit hook blocked your commit

The hook runs the same check on your staged files only. It applies safe fixes first. A staged file with only old errors still commits.

Fix the error that the hook names, then commit again.

## The counts change when you run it locally

The type-aware rules read the built types of other packages in `dist/`. If a package is not built, its imports have the type `any`, and the counts change. The check prints a warning when this happens.

Run `pnpm build`, then run `pnpm lint` again.

## Done

`pnpm lint` and `pnpm lint:dead-code` both end with `OK`. Push your branch.

To change a rule or the baseline, read [Change the lint rules](./static-analysis-rules.md).
