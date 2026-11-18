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

To print the summary tables in `baseline.md` from the JSON reports, and write
every test that kills no mutant to `reports/mutation/idle-tests.md`:

```sh
pnpm nx run repo-scripts:mutation-report
```

## Tests that kill no mutant

Deleting a test that kills no mutant lets no mutant survive. That does not
always make the test useless. The idle list gives each test one reason:

| Reason      | Meaning                                                                                                     | What to do                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `runs-code` | The test runs mutated code, and no mutant made it fail.                                                     | Most likely rot. Make its assertions specific, or delete it.                                |
| `timeout`   | The test runs a mutant that ended in a timeout. Stryker does not record which test caused a timeout.        | Inconclusive. The test may have caught the mutant.                                          |
| `no-code`   | The test runs no mutated code in this package: another package, types, module-level code or a skipped file. | Not proof of rot. Check what it tests, or measure it with the package whose code it covers. |

After you delete or rewrite tests, run Stryker on the source files they cover
(`--mutate`) and check that the score did not drop.

To merge the reports of a package that ran as shards, name them after `=`:

```sh
node scripts/mutation/summarize.mjs --idle-out idle-tests.md \
  packages/react-core=a/mutation.json,b/mutation.json,c/mutation.json
```

`--idle-reasons runs-code` keeps only some reasons in the list.

## CI

[`test_mutation.yml`](../../.github/workflows/test_mutation.yml) runs the three
packages every Monday and on `workflow_dispatch`. It does not run on PRs
because it is too slow. react-core runs as three jobs (`components/`,
`generative-ui/` and the rest) so each job stays under the timeout. Each job
caches its incremental file and uploads the HTML and JSON reports as an
artifact (`mutation-report-<shard>`).

A `report` job then merges the three react-core shards (a test in one shard
can kill mutants in another) and:

- writes the summary tables to the run page,
- uploads `summary.md`, `idle-tests.md` (every idle test) and `likely-rot.md`
  (only `runs-code`) as the `mutation-summary` artifact,
- on the default branch, keeps one open issue titled **Mutation testing:
  weekly report** up to date. Each run replaces the issue body with the latest
  summary and the `runs-code` list, and adds a comment with the scores. Watch
  that issue to get notified. If you close it, the next run opens a new one.

If a shard fails or times out, the summary says which shard has no report.

GitHub starts scheduled runs only from the default branch, and lists a
`workflow_dispatch` workflow only after the file is on the default branch. So
the job starts working when `2.0.0` merges into `main`.

There is no failing threshold yet. The baseline comes first.
