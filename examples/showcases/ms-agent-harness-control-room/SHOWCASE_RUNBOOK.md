# MS Agent Harness Control Room Showcase Runbook

This is the presenter-facing checklist for the Microsoft Agent Harness +
CopilotKit showcase. The point of the demo is:

**Microsoft Agent Harness orchestrates planning, todos, memory, skills,
file/shell tools, and approvals. CopilotKit makes that orchestration visible,
operable, and generative over AG-UI.**

## Showcase Path

Use the CopilotChat starter suggestions as the primary demo surface. They are
deliberately one-click entry points rather than presenter step buttons.

1. **Plan repair + health table**
   - Shows Harness planning mode, skill loading, file inspection, and todo
     creation.
   - Expected UI: `showRunHealthTable` and `showHarnessSummary`.

2. **Estimate timeline**
   - Shows how the same Harness state can drive a schedule view.
   - Expected UI: `showRepairCalendar` plus a short summary.

3. **Show capability coverage**
   - Shows MAH as an orchestrator instead of only a bug-fix agent.
   - Expected UI: `showCapabilityRadar` and `showToolUsageDonut`.

4. **Run with approval readiness**
   - Applies the minimal calculator fix, then shows a readiness form before the
     real approval-gated shell command.
   - Expected UI: `showApprovalReadinessForm`, real Harness approval card, and
     `showRepairTrendChart`.

5. **Verify and hand off**
   - Runs coverage, saves a short handoff to memory, and summarizes the result.
   - Expected UI: `showCoverageAreaChart`, `showHandoffForm`, and
     `showHarnessSummary`.

The seeded bug is still simple by design: `calculator.ts` has `add(a, b)`
returning `a - b`. The expected patch is `a + b`.

## Showcase Drawer

The left-side drawer has two panes:

- A vertical icon rail for **Generative UI**, **State**, and **Settings**.
- A detail pane that defaults to the Generative UI catalog.

Keep **Generative UI** open for the main story. Use **State** when the audience
asks what Harness knows right now. Use **Settings** for setup, remote endpoint
switching, manual commands, structured output, skills, or feature details.

## Requirement Audit

| Requirement | Status | Evidence |
| --- | --- | --- |
| Reference Harness agent in C# wrapped with MAF AG-UI | Done | `agent/ControlRoomAgent.cs`, `agent/Program.cs`, `MapAGUI("/")` |
| Agentic chat | Done | `CopilotKitProvider` uses `selfManagedAgents` with `HttpAgent` |
| Backend/tool rendering | Done | `ToolRendererRegistry` handles Harness approval, `pnpm_run`, file reads, generated result, and generic events |
| HITL approvals | Done | `ApprovalContentWireBridge.cs` plus `HarnessApprovalCard.tsx` |
| Agentic generative UI | Done | `useComponent` registrations in `GenerativeUICatalog.tsx` |
| Shared state | Partial, honest workaround | Harness provider state is derived from AG-UI messages in `use-control-room-state.tsx` |
| Predictive state updates | Upstream blocked | Requires native Harness `STATE_SNAPSHOT` / `STATE_DELTA` emission |
| Shell execution | Done through safe substitute | `pnpm_run` allow-lists `install`, `test`, `test:coverage`, `typecheck` and is approval-gated |
| File access | Done | Harness `FileAccessStore` is sandboxed to `.control-room-fixture` |
| File memory | Done | Harness `FileMemoryStore`; handoff suggestion saves memory |
| Skills | Done | `fixture-diagnosis` skill and `SkillsPanel` |
| Tool approvals with remember session | Done | `HarnessApprovalCard` sends `always_approve` when remember is checked |
| Mode display/toggle | Done | State panel plus Settings `ModeControls` |
| Todos panel | Done | State panel plus derived todo state |
| Commands primitive | Done, demoted | `CommandControls` lives in Settings |
| Observers primitive | Done, summarized | State panel plus Settings feature details |
| Feature autodetection | Done | agent `/features` endpoint feeds `ConnectionStatus` and State panel |
| Local/remote endpoint switching | Done, demoted | Settings `EndpointSelector`; direct `HttpAgent` wiring |
| Terminal shell renderer | Done | `ShellOutputCard` renders `pnpm_run` output |
| File viewer/diff renderer | Done | `FileReadCard`; legacy `DiffProposalCard` is display-only fallback |
| Structured output on demand | Done, demoted | `StructuredOutputControl` and `StructuredDiagnosisPanel` in Settings |
| Codact/Hyperlite renderer | Upstream/product blocked | Surface is still undefined in the Notion doc |

## Upstream Asks

These are not repo-side blockers, but they are still the honest Microsoft asks.
Issue-ready drafts live in [UPSTREAM_ISSUE_DRAFTS.md](./UPSTREAM_ISSUE_DRAFTS.md).

1. Harness providers should emit `STATE_SNAPSHOT` / `STATE_DELTA`.
2. MAF AG-UI bridge should serialize non-FunctionCall `AIContent`, especially
   `ToolApprovalRequestContent`.
3. Microsoft should publish the signed `Microsoft.Agents.AI.Tools.Shell`
   package for the target preview version.
4. Microsoft should define the Codact/Hyperlite render surface before we can
   implement that renderer.

## Verification Commands

One-command smoke gate:

```bash
pnpm -C examples/showcases/ms-agent-harness-control-room run verify:stage
```

Build gate:

```bash
pnpm -C examples/showcases/ms-agent-harness-control-room build
```

Browser rehearsal should show:

- the left-side drawer opens on desktop and mobile
- the two-pane sidebar defaults to Generative UI
- CopilotChat starter suggestions are visible
- no presenter step buttons are visible
- the State panel shows mode, todos, files, approvals, memory, skills, and
  feature support
- the Settings panel exposes endpoint switching, commands, structured output,
  skills, and feature support
- one visible Harness approval for `pnpm_run("test")`
- file cards for `calculator.ts` and `calculator.test.ts`
- shell cards for `test` and `test:coverage`
