# Pause checkpoint

Paused at the user's request. No integration is fully qualified. Resume from branch `tyler/docs-feature-audit` in this worktree; do not restart the audit or overwrite its original RED evidence.

## Verified work saved

- Source-backed guide, routing, extraction, and setup repairs are committed with scoped evidence in the hill tracker and repair ledger.
- Latest LangGraph Python dependency update: native graph startup and three local replay cells passed (`24401cb24f`). This does not qualify its full matrix or JavaScript dependency set.
- Shared browser-relative runtime URL fix: independently reviewed; 841 core tests, build, uncached publint and attw passed. Three Built-in Agent cells pass with the patched local core (`6e7ad99316`). The published SDK failure is preserved; the fix has not been released.
- The last complete docs suite was **911/922 tests passing**. Subsequent focused repairs passed, but no later complete suite has been run.

## Unfinished work saved as a checkpoint

These changes are preserved for continuation, not declared validated:

- REPAIR-008: local embed config now boots in actual Next.js; revised focused config test still needs rerunning.
- REPAIR-009: Built-in Agent configuration guide now uses actual Showcase regions; independent review clear, focused checks and final reader demonstration pending.
- REPAIR-010: server-provided runtime config replaces the invalid footer URL; new SSR regression and actual HTTP/browser checks pending.
- C025: CrewAI HITL source-backed rewrite and C030: framework-aware MAF example selector; focused validation pending.
- Built-in Agent dependency/lock update: independent dependency and normal clean-install review pending. Its local `node_modules` still contains a temporary patched-core overlay installed without changing the lockfile. Recreate or restore dependencies deliberately when resuming; never confuse this with the published SDK.
- C031: the Pydantic state-rendering cell has no implemented matching backend publisher. Recorded as an implementation gap; no fabricated replacement snippet was added.
- Copy/View prompt behavior was inconclusive in the in-app browser and still needs diagnosis.

## Resume order

1. Inspect the hill tracker, repair ledger, current git status, and checkpoint commit. Read source through subagents, as requested by the user.
2. Review the Built-in Agent dependency unit. Run the pending docs contracts in one bounded slot after pretypecheck: inline demo URL, runtime config/SSR footer, selected Showcase provenance, and current authored guides.
3. Start one current docs preview with `SHOWCASE_LOCAL=1` and one selected framework stack. Repeat the preserved Built-in Agent configuration interaction and verify the actual local iframe, source, API links, and prompt behavior.
4. Finish the remaining latest-stable dependency work, full five-framework matrices, media failures, and per-guide reader gates. Run the final complete docs suite and build only after the relevant source is stable.

The aggregate audit memory ceiling is **30 GB**, with a lower working target. Use at most two docs test forks with a 4 GiB Node heap cap, one framework stack, and explicit worker cleanup. Do not overlap heavy builds and full test suites. See `resource-budget.md`.

Audit-owned docs and integration servers, AIMock, and test/build workers were stopped for this pause. Existing user services were left alone.
