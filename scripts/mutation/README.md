# Mutation testing

We use mutation testing to find tests that catch nothing.
[Stryker](https://stryker-mutator.io) makes small changes to the source code,
called **mutants**. Examples: it changes `a < b` to `a <= b`, removes a
function call, or replaces a string with `""`. Then it runs the tests that
cover that code.

- A mutant is **killed** when at least one test fails. The tests saw the
  change.
- A mutant **survived** when all tests pass. The tests did not see the change.
- A mutant has **no coverage** when no test runs that code.

The **mutation score** is `killed / (killed + survived + no coverage)`. A
timeout counts as killed. The **covered score** leaves out no-coverage mutants.
It shows how good the tests are where tests exist.

The bar for new tests is in [.claude/docs/testing.md](../../.claude/docs/testing.md).
The current numbers are in [baseline.md](baseline.md).

## Packages

| Package                  | Nx target                                     |
| ------------------------ | --------------------------------------------- |
| `@copilotkit/core`       | `nx run @copilotkit/core:test:mutation`       |
| `@copilotkit/runtime`    | `nx run @copilotkit/runtime:test:mutation`    |
| `@copilotkit/react-core` | `nx run @copilotkit/react-core:test:mutation` |

Each package has a `stryker.config.mjs` that calls `defineMutationConfig()` in
[stryker.base.mjs](stryker.base.mjs). The shared config:

- Mutates `src/**/*.{ts,tsx}`. It skips test files, `__tests__/` folders and
  generated files.
- Uses the vitest runner with `perTest` coverage. Each mutant runs only the
  tests that cover it.
- Sets `disableBail: true`. All covering tests run for each mutant, so the
  report knows every test that kills it. We need this to find test files that
  kill nothing.
- Sets `ignoreStatic: true`. Static mutants (code that runs once when a module
  loads) rerun the full suite for each mutant. They are skipped.
- Runs in incremental mode. Stryker keeps
  `reports/mutation/stryker-incremental.json` and on the next run tests only
  the mutants whose code or covering tests changed.
- Sets `inPlace: true`. Stryker changes the real files in `src/`, not a copy.
  Some runtime and react-core tests import other packages by relative path,
  and those paths break in a copy. Stryker puts the files back when it stops.
  Do not edit the package while it runs. If the run is killed, run
  `git checkout packages/<name>/src`.

## Run it

A full run takes hours. Run it on the files you changed:

```sh
pnpm nx run @copilotkit/core:test:mutation -- --mutate "src/core/my-file.ts"
```

Other useful flags (pass them after `--`):

- `--mutate "src/core/**/*.ts"` tests only these files.
- `--force` ignores the incremental file and retests every mutant.
- `--concurrency 4` sets the number of test processes. The default is half the
  CPU cores. You can also set `STRYKER_CONCURRENCY`.

The results are in `packages/<name>/reports/mutation/`:

- `mutation.html` shows every mutant in the source. Open it in a browser.
- `mutation.json` is the raw report.

To print the summary tables in `baseline.md` from the JSON reports:

```sh
pnpm nx run repo-scripts:mutation-report
```

## CI

[`test_mutation.yml`](../../.github/workflows/test_mutation.yml) runs the three
packages every Monday and on `workflow_dispatch`. It does not run on PRs
because it is too slow. The incremental file is cached between runs. Each job
writes its summary to the job page and uploads the HTML and JSON reports as an
artifact.

There is no failing threshold yet. The baseline comes first.
