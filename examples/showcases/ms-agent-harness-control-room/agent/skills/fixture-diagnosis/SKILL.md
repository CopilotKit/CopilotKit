---
name: fixture-diagnosis
description: |
  Step-by-step playbook for diagnosing a failing test inside the fixture
  repo. Use this skill when the operator asks you to "fix the seeded failing
  test" or to inspect why `pnpm_run("test")` is returning a non-zero exit
  code. Always run `pnpm_run("install")` before the first test invocation if
  vitest is missing.
---

# Fixture diagnosis

The fixture repo is a tiny Vitest project under `.control-room-fixture/`
exposing three functions in `src/calculator.ts`:

- `add(a, b)`
- `subtract(a, b)`
- `calculateCoverageSummary()`

The accompanying tests in `src/calculator.test.ts` expect:

1. `add(2, 3) === 5`
2. `subtract(7, 4) === 3`
3. `calculateCoverageSummary()` returns a non-empty string

## Procedure

1. Read `src/calculator.ts` and `src/calculator.test.ts` with
   `FileAccess_ReadFile` to understand the current contract.
2. Run `pnpm_run("test")` to reproduce the failure. If you see
   `vitest: not found`, run `pnpm_run("install")` first.
3. Patch `src/calculator.ts` with the minimal change needed to satisfy
   the test expectations. Prefer `FileAccess_WriteFile`.
4. Re-run `pnpm_run("test")` to confirm green.
5. Run `pnpm_run("test:coverage")` and capture the coverage summary in
   memory via `FileMemory_SaveFile("fixture-postmortem.md", ...)`.

## Notes

- Do NOT modify the test file — the tests are the contract.
- Only the four scripts `install`, `test`, `test:coverage`, `typecheck`
  are runnable via `pnpm_run`. Other commands will return an error.
