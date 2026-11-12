# The Bar for New Tests

A test that passes no matter what the code does is test rot. We measure it with
mutation testing: [Stryker](https://stryker-mutator.io) makes small changes to
the source (flips `<` to `<=`, removes a call, empties a string) and runs the
tests. A change that no test catches is a **survived mutant**. The **mutation
score** is the share of mutants the tests catch.

The baseline, the commands and how to read a report are in
[scripts/mutation/README.md](../../scripts/mutation/README.md).

## Rules

1. **A new test must kill mutants in the code it covers.** If you can delete
   the assertion, or revert the fix, and the test still passes, the test is
   rot. Do not add it.
2. **New or changed code in `@copilotkit/core`, `@copilotkit/runtime` or
   `@copilotkit/react-core` must score at least 80% on its files.** Never lower
   a file's score below what it was before your change.
3. **Check it before you open the PR.** Run Stryker on only the files you
   changed:

   ```sh
   pnpm nx run @copilotkit/core:test:mutation -- --mutate "src/core/my-file.ts"
   ```

   Then open `packages/core/reports/mutation/mutation.html`. For each survived
   mutant, add an assertion that fails on it, or say in the PR why the mutant
   is equivalent (it does not change behavior).

## What kills mutants

- Assert on the output and on the effects the caller sees: return values,
  emitted events, state, thrown errors with their message.
- Cover both sides of every condition you add, including the boundary
  (`n === limit`, not only `n > limit`).
- Do not only assert that a mock was called. Assert what it was called with.
- A snapshot, `toBeDefined()` or `toBeTruthy()` on its own kills almost
  nothing. Assert the specific value.
