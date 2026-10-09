# Runtime contract changes

Use the shared suite as the contract for all five runtime implementations.
Read [README.md](README.md) before a behavior change.

1. State the public behavior and cite its source contract or explain an intentional correction.
2. Add a shared case when the behavior applies across languages.
3. Run the case against the affected implementation before the production fix. Record the command and assertion failure.
4. Make the smallest production fix. Run the case again and record the passing result.
5. Run the complete shared suite for every driver after a shared contract change.

A missing dependency, syntax error, or empty test selection is not a behavior failure.
Preserve stable case IDs so reviewers can rerun each regression.
Add native tests for language-specific behavior that the public socket contract cannot expose.
Do not weaken a shared assertion to match an implementation defect.
Preserve fault injection, strict event ordering, immutable replay, and the negative stub test.

An engineer other than the author must review shared contract changes.
The review must cover the assertions and fixture, not only the runtime fix.
Keep the `Intelligence runtime conformance` gate required in the GitHub branch rules.
Do not bypass the gate to merge a runtime change.

Record new regression evidence in [REGRESSIONS.md](REGRESSIONS.md).
Include the failing assertion, affected implementation, source baseline, fix, and passing command.
Distinguish local socket tests, native unit tests, CI, and deployed-service validation.
