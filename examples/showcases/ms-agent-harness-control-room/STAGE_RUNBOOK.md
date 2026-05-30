# MS Agent Harness Control Room Stage Runbook

This is the presenter-facing checklist for the simplified Build demo. The point of the demo is:

**Microsoft Agent Harness orchestrates planning, todos, memory, skills, file/shell tools, and approvals. CopilotKit makes that orchestration visible and operable over AG-UI.**

## Stage Path

1. **Connect**
   - Confirm the status chip is `ONLINE`.
   - Use **Reset** before rehearsal so the fixture starts with the seeded failing test.

2. **Plan**
   - Shows Harness planning mode, skill loading, and todo creation.
   - Expected evidence: `fixture-diagnosis loaded`, todos appear, memory may contain `fixture-fix-plan.md`.

3. **Inspect**
   - Shows Harness file access against the fixture sandbox.
   - Expected evidence: file cards for top-level `calculator.ts` and `calculator.test.ts`.
   - Do not use any `src/` path in the story; the fixture is intentionally flat.

4. **Fix**
   - Shows the smallest file edit: `add(a, b)` changes from `a - b` to `a + b`.
   - Expected evidence: mode moves to Act/execute and file evidence updates.

5. **Approve + Run**
   - Shows the real Harness approval card before `pnpm_run("test")`.
   - The remember checkbox defaults on for stage safety. That is intentional: the first approval is visible, and later matching `pnpm_run` calls are covered by Harness session state.
   - If dependencies are missing, the agent runs `install` and retries `test`.

6. **Verify**
   - Runs `pnpm_run("test:coverage")`.
   - Expected evidence: Last Test is `test:coverage`, status is Passing, shell output is visible.

7. **Review**
   - Saves a handoff/post-mortem memory file.
   - Expected evidence: memory includes `fixture-postmortem.md`.

## Advanced Drawer

Keep this closed during the main story. Open it only if the audience asks about power-user/debug surfaces.

It intentionally preserves the Notion-required non-stage controls:

- endpoint switching for local/remote AG-UI Harness endpoints
- fixture reset and reconnect
- manual Plan/Act mode controls
- raw command shortcuts
- structured-output trigger and typed inspector
- manual skill loading
- feature autodetection details

## Notion Requirement Audit

| Requirement | Stage status | Evidence |
| --- | --- | --- |
| Reference Harness agent in C# wrapped with MAF AG-UI | Done | `agent/ControlRoomAgent.cs`, `agent/Program.cs`, `MapAGUI("/")` |
| Agentic chat | Done | `CopilotKitProvider` uses `selfManagedAgents` with `HttpAgent` |
| Backend/tool rendering | Done | `ToolRendererRegistry` handles Harness approval, `pnpm_run`, file reads, generated result, and generic events |
| HITL approvals | Done | `ApprovalContentWireBridge.cs` plus `HarnessApprovalCard.tsx`; browser rehearsal showed one `pnpm_run` approval |
| Agentic generative UI | Done | `generated_result_card` renderer remains registered |
| Tool-based generative UI | Done | wildcard `useRenderTool({ name: "*" })` dispatches tool-specific cards |
| Shared state | Partial, honest workaround | Harness provider state is derived from AG-UI messages in `use-control-room-state.tsx` |
| Predictive state updates | Upstream blocked | Requires native Harness `STATE_SNAPSHOT` / `STATE_DELTA` emission |
| Shell execution | Done through safe substitute | `pnpm_run` allow-lists `install`, `test`, `test:coverage`, `typecheck` and is approval-gated |
| File access | Done | Harness `FileAccessStore` is sandboxed to `.control-room-fixture` |
| File memory | Done | Harness `FileMemoryStore`; stage saves `fixture-postmortem.md` |
| Skills | Done | `fixture-diagnosis` skill and `SkillsPanel` |
| Tool approvals with remember session | Done | `HarnessApprovalCard` sends `always_approve` when remember is checked |
| Mode display/toggle | Done | compact evidence panel plus Advanced `ModeControls` |
| Todos panel | Done | compact evidence panel plus derived todo state |
| Commands primitive | Done, demoted | `CommandControls` lives in Advanced |
| Observers primitive | Done, demoted/summarized | compact evidence panel plus Advanced feature details |
| Feature autodetection | Done | agent `/features` endpoint feeds `ConnectionStatus`/evidence panel |
| Local/remote endpoint switching | Done, demoted | Advanced `EndpointSelector`; direct `HttpAgent` wiring |
| Terminal shell renderer | Done | `ShellOutputCard` renders `pnpm_run` output |
| File viewer/diff renderer | Done | `FileReadCard`; legacy `DiffProposalCard` is display-only fallback |
| Structured output on demand | Done, demoted | `StructuredOutputControl` and `StructuredDiagnosisPanel` in Advanced |
| Codact/Hyperlite renderer | Upstream/product blocked | Surface is still undefined in the Notion doc |

## Upstream Asks

These are not repo-side blockers, but they are still the honest Microsoft asks. Issue-ready drafts live in [UPSTREAM_ISSUE_DRAFTS.md](./UPSTREAM_ISSUE_DRAFTS.md).

1. Harness providers should emit `STATE_SNAPSHOT` / `STATE_DELTA`.
2. MAF AG-UI bridge should serialize non-FunctionCall `AIContent`, especially `ToolApprovalRequestContent`.
3. Microsoft should publish the signed `Microsoft.Agents.AI.Tools.Shell` package for the target preview version.
4. Microsoft should define the Codact/Hyperlite render surface before we can implement that renderer.

## Verification Commands

One-command smoke gate:

```bash
pnpm -C examples/showcases/ms-agent-harness-control-room run verify:stage
```

Equivalent manual commands:

```bash
pnpm -C examples/showcases/ms-agent-harness-control-room build
docker compose -f examples/showcases/ms-agent-harness-control-room/docker-compose.yml build agent
curl http://localhost:8000/health
curl http://localhost:8000/features
```

Browser rehearsal should end with:

- one visible Harness approval for `pnpm_run("test")`
- remembered approval covering the follow-up `install`, retry, and `test:coverage`
- file cards for `calculator.ts` and `calculator.test.ts`
- shell cards for `test` and `test:coverage`
- Last Test: `test:coverage`, Passing
- memory includes `fixture-postmortem.md`
