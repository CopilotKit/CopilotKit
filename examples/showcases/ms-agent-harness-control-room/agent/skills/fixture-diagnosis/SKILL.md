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

The fixture repo is a tiny Vitest project exposed to Harness file tools as the
current file sandbox. Use the top-level paths `calculator.ts` and
`calculator.test.ts`; do not prefix them with `.control-room-fixture/`, `src/`,
`/app/`, or an absolute path. The fixture exposes three functions in
`calculator.ts`:

- `add(a, b)`
- `subtract(a, b)`
- `calculateCoverageSummary()`

The accompanying tests in `calculator.test.ts` expect:

1. `add(2, 3) === 5`
2. `subtract(7, 4) === 3`
3. `calculateCoverageSummary()` returns a non-empty string

## Procedure

Important path rule: `calculator.ts` and `calculator.test.ts` are at the
fixture repo root from the perspective of `FileAccess_ReadFile` and
`FileAccess_WriteFile`. Use those exact paths.

Follow the operator's current prompt. If the prompt says to inspect, plan, or
visualize without editing or running commands, stop before the patch/test steps
below and do only the requested read-only work.

1. Read `calculator.ts` and `calculator.test.ts` with
   `FileAccess_ReadFile` to understand the current contract.
2. Run `pnpm_run("test")` to reproduce the failure only when the operator asks
   to execute or verify. If you see
   `vitest: not found`, run `pnpm_run("install")` first.
3. Patch `calculator.ts` with the minimal change needed to satisfy
   the test expectations. Prefer `FileAccess_WriteFile`.
4. Re-run `pnpm_run("test")` to confirm green.
5. Run `pnpm_run("test:coverage")` and capture the coverage summary in
   memory via `FileMemory_SaveFile("fixture-postmortem.md", ...)`.

## Notes

- Do NOT modify the test file — the tests are the contract.
- Only the four scripts `install`, `test`, `test:coverage`, `typecheck`
  are runnable via `pnpm_run`. Other commands will return an error.
