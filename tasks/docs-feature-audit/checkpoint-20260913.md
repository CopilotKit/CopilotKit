# Pause checkpoint — September 13, 2026

Paused at the user's request. **The goal is not complete. No integration has complete docs/setup/provider qualification.**

## Verified and committed

- Built-in Agent final strict local replay: **38/38 published checks pass; raw matrix 38/39**. The sole raw failure is an explicitly unshipped thread-ID demo, preserved in the log. See [comparison](built-in-agent-runtime-comparison-20260913.md). This uses public CopilotKit 1.71.1 plus the unreleased local core URL repair. Unpatched public 1.71.1 remains incompatible with the relative runtime URL.
- Actual normal-browser image/PDF sample actions, configured-agent behavior, scoped TypeScript Authentication prompt, and prepared voice transcript handoff were observed. Voice microphone capture/transcription and paperclip upload were not proved by the sample actions.
- Shared React Auth, attachment, state, and voice examples are canonicalized and synchronized. Commits: `1947f20ccf`, `6c38d7ef74`.
- BIA discovery routes and request-capture accuracy repaired: `be9052f5c5`, `1f9082b919`. Strict replay regression: `0579611845`, `cf8066044c`.
- Source-backed guide family and command-only source bundling: `f50d3ad853`; pretypecheck, 18 focused docs checks and nine bundling checks passed at that revision.
- LGTS tool schemas now match their implementations; isolated strict graph typecheck passed. Commit `45d7ec00bb`.
- Latest ADK/Strands direct Python dependency sets resolve, install, and import in isolated environments. This is not a runtime matrix or full guide setup pass.

## Unfinished work preserved as WIP

1. **LGTS latest stable dependency update.** Four package/lock files. Both ordinary `npm ci --ignore-scripts` runs passed (agent 259 packages; UI 958), and strict graph typecheck passed. Agent registered graphs but could not bind because an old audit watcher held the port. No latest-pinned UI/agent matrix ran. Logs are `checkpoint-lgts-*-latest-*.log` in this directory.
2. **Shared resolver and selected-guide guard (REPAIR-022/027).** HTML and Markdown now share a WIP resolver; the guard derives bindings from Showcase metadata and checks actual rendered output. It caught the wrong read/write route and then **20 setup-skipped markers**. Last full selected-guide verdict is RED, not qualified.
3. **LGP four guides (REPAIR-023–026).** Streaming, read/write, readonly context, and subagents have source-backed rewrites. Read/write mapping and old-URL redirects are corrected in WIP. Rerun still required; do not reinstate narrative exceptions.
4. **State-rendering identity (part of REPAIR-027).** Root guide incorrectly used unsupported streaming-state demos for BIA/Strands. WIP switches it to actual `gen-ui-agent`, adds canonical frontend and backend source regions. This final atomic edit is unreviewed/unvalidated. Source-file inventory: [checkpoint files](checkpoint-20260913-source-files.json).
5. **Media/voice completeness.** WIP image/PDF scope and prepared-text wording; a real FileReader adapter test; LGTS local-only transcription base-URL helper/test/config. These latest tests have not run. Strict AIMock WAV upload fixture and valid/wrong/empty HTTP checks are not implemented. Browser paperclip verification needs a shared harness capability; no integration-specific shortcut was added.
6. **Exact setup and final validation.** Clone-based LGTS BYO instructions and reproduction script exist; final latest-pinned graph boot remains pending. Other four fresh matrices, exact setup checks, rendered route review, docs typecheck/build/full suite, and final reader sanity remain open. Last historical full docs run was 947/948; its stale assertion was fixed and focused checks passed, but no fresh full-suite green exists.

## Safe restart order

1. Read this checkpoint, the hill tracker, current git status, and `showcase/AGENTS.md`. Keep root out of raw code; use the existing Terra/high agents.
2. Independently review the final Gen UI/source-identity WIP. Run shared frontend drift check and pretypecheck, then the focused rendered guard. Resolve REPAIR-027's real setup omissions without suppressing markers or using another framework's source.
3. Start one latest-pinned LGTS stack; finish its exact setup and full runtime matrix. Continue LGP, ADK, and Strands sequentially. Preserve public-package vs local-patch evidence.
4. Complete the bounded upload/transcription replay and final docs/reader gates. Update per-guide status from actual evidence.

## Resource shutdown

All agents paused. Docs preview/generator/Vitest workers stopped. BIA UI and AIMock stopped. Old LGTS CLI trees `97732/97071/97074` and `96390/97072/98397` stopped; 8123 and 8124 released. No new stack was launched after the pause request. Preserve user/app processes. Continue with the 30 GB aggregate audit limit and one framework stack.

Checkpoint commits save unfinished work for resumption. They are not a merge, release, deployment, or claim of validation.
