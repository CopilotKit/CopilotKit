# Change the lint rules

To change which errors fail CI, edit the config, then write a new baseline:

```sh
pnpm lint:baseline
```

This page is for maintainers. To fix a failing check, read [Fix a failing lint check](./static-analysis.md).

## Where the parts are

| Part         | Path                                                                     |
| ------------ | ------------------------------------------------------------------------ |
| oxlint rules | `.oxlintrc.json` (the first `overrides` entry is for `packages/` source) |
| Custom rules | `tools/oxlint-rules/`                                                    |
| knip config  | `knip.json`                                                              |
| Baselines    | `.lint-baseline/oxlint.json`, `.lint-baseline/knip.json`                 |
| The check    | `scripts/lint/gate.ts`                                                   |
| CI jobs      | `oxlint` and `knip` in `.github/workflows/static_quality.yml`            |

Only errors fail the check. Warnings print as a count.

## Add or change an oxlint rule

1. Add the rule to the `packages/` source entry in `.oxlintrc.json`, with severity `error`.
2. If the rule also matches test files, add it as `off` to the test entry below it.
3. Run `pnpm lint:baseline`.
4. Read the diff of `.lint-baseline/oxlint.json`. Make sure that it has no files outside `packages/` and no test files.
5. Commit the config and the baseline together. In the commit message, give the reason for the rule.

Rules that need types run only in the type-aware pass over `packages/`. Build the packages first (`pnpm build`), or the baseline gets the wrong counts.

An override cannot set a category, so that entry lists every rule in the `correctness` and `suspicious` categories by name. The test entry sets the same rules back to `warn`. When an oxlint upgrade adds a rule to these categories, `scripts/__tests__/lint-category-rules.test.ts` fails and names the rule. Add it to both lists, then run `pnpm lint:baseline`.

The first five rules in that entry have no baseline entries. If you add one of them to a new scope, fix its errors. Do not baseline them.

## Add a custom rule

1. Write the rule in `tools/oxlint-rules/<name>.mjs`. Copy the shape of `no-swallowed-error.mjs`.
2. Write `tools/oxlint-rules/<name>.test.mjs` with `RuleTester`. Copy the Node 22 guard from `no-single-arg-zod-record.test.mjs`.
3. Register the rule in `tools/oxlint-rules/copilotkit-plugin.mjs`.
4. Run `pnpm nx run oxlint-rules:test`.
5. Turn the rule on in `.oxlintrc.json` as `copilotkit/<name>`, then do the steps in the section above.

## Change what knip reports

knip reads `knip.json`. It checks the JS packages in `packages/` and ignores showcase, examples, codemods, tools, and the packages for other languages.

- **A new package:** the `packages/*` entry covers it. If its entry files are not `src/index.ts`, add an entry for that package.
- **A dependency that knip cannot see** (for example, a name used only in `vi.mock`): add it to `ignoreDependencies` for that package. Say why in the commit message.
- **Real dead code:** do not ignore it. Delete it, or leave it in the baseline.

When you change `knip.json`, run `pnpm lint:dead-code:baseline` and commit the new `.lint-baseline/knip.json`.

## Done

`pnpm lint` and `pnpm lint:dead-code` end with `OK`, and the diff shows the baseline that you expect.
