# Microsoft Agent Harness Upstream Issue Drafts

These drafts are copied from the Notion upstream asks and the simplified stage audit. They are ready to paste into `microsoft/agent-framework` or hand to the Microsoft PM/engineering team.

## 1. Harness providers should emit AG-UI STATE_SNAPSHOT / STATE_DELTA

### Problem

Harness's built-in providers (`TodoListProvider`, `AgentModeProvider`, `FileMemoryProvider`, `AgentSkillsProvider`) currently surface state changes through tool calls, but the session state itself does not flow out as AG-UI `STATE_SNAPSHOT` or `STATE_DELTA` events.

### Why it matters

AG-UI frontends need a stable state channel for mode, todos, memory, and skills. Without native state events, integrators have to reconstruct Harness state by scanning message history and tool-call results. The Control Room demo does that in `use-control-room-state.tsx`, but it is intentionally documented as a workaround.

This also blocks the AG-UI predictive state update story, because there is no canonical Harness state stream to predict against.

### Suggested fix

Have each Harness provider publish its session-scoped state into AG-UI state events:

- emit an initial `STATE_SNAPSHOT` when a run/session starts or reconnects
- emit `STATE_DELTA` after provider mutations
- include provider namespaces so clients can merge state without guessing ownership

### Acceptance criteria

- A frontend can read current mode, todos, memory files, and loaded skills from AG-UI state without parsing tool calls.
- Client writes to mode/todos round-trip deterministically: client request -> Harness provider mutation -> AG-UI state update -> next agent turn observes the same state.
- Existing tool-call rendering continues to work for tool evidence.

## 2. AG-UI bridge should serialize non-FunctionCall AIContent

### Problem

The MAF AG-UI bridge serializes `FunctionCallContent` and `TextContent`, but drops other `AIContent` subtypes. The important subtype for the Control Room demo is `ToolApprovalRequestContent`.

### Why it matters

Harness's `ToolApprovalAgent` emits approval requests as structured AI content. If the AG-UI bridge drops that content, a browser cannot show the real approval card. The Control Room demo ships `ApprovalContentWireBridge.cs`, which converts `ToolApprovalRequestContent` into a synthetic `request_approval` tool call and converts the tool result back into Harness approval response content.

That bridge keeps the demo honest, but every AG-UI Harness integrator would need the same workaround until the bridge supports non-FunctionCall content natively.

### Suggested fix

Extend the AG-UI bridge to serialize:

- `ToolApprovalRequestContent`
- `ToolApprovalResponseContent`
- `AlwaysApproveToolApprovalResponseContent`
- `TextReasoningContent` if not already covered

This can use a dedicated event type or an existing tool-call-shaped event with a discriminator, as long as clients can distinguish approval requests from ordinary function calls.

### Acceptance criteria

- A Harness approval request reaches AG-UI clients without an app-side `DelegatingAIAgent` bridge.
- Client approval/rejection returns to Harness as native approval response content.
- Session-scoped "always approve" rules still work.
- Existing FunctionCall/Text behavior remains backward compatible.

## 3. Publish signed Microsoft.Agents.AI.Tools.Shell package

### Problem

The Notion status doc identified `Microsoft.Agents.AI.Tools.Shell 1.6.2-preview.260521.1` as missing from nuget.org while the rest of the preview package set was available.

### Why it matters

Without the signed package, applications cannot reference the official `ShellExecutor` type from the matching Harness preview. The Control Room demo bundles a locally rebuilt package in `local-nuget/`, but because that copy is not Microsoft-signed, the app avoids compile-time dependency on `ShellExecutor` and uses a narrow `pnpm_run` function instead.

The substitute is safer for the stage fixture, but it does not prove the general Harness shell provider surface.

### Suggested fix

Publish the signed `Microsoft.Agents.AI.Tools.Shell` package that matches the Harness preview package set, or document the replacement package/version if this moved in newer previews.

### Acceptance criteria

- A clean app can reference the signed Tools.Shell package from nuget.org or an official Microsoft feed.
- The package version aligns with the Harness/AG-UI preview package set.
- Consumers can register the real shell executor without local package rebuilds.

## 4. Define the Codact / Hyperlite AG-UI render surface

### Problem

The Notion engineering checklist includes a Codact/Hyperlite renderer, but marks the surface as TBD. There is not enough contract information to implement an honest renderer.

### Why it matters

The Control Room demo can preserve a placeholder and keep generic tool rendering available, but a stage-ready Codact renderer needs a defined payload shape, lifecycle, and security model. Guessing would create a demo-only surface that Microsoft may not ship.

### Needed decision

Microsoft should define:

- whether Codact/Hyperlite appears as AG-UI tool calls, custom events, state, or structured AI content
- payload schema and versioning
- iframe/sandbox expectations, if any
- how approval/HITL should interact with the renderer
- whether CopilotKit should render it as a generic AG-UI extension or a Harness-specific component

### Acceptance criteria

- A sample Harness agent can emit a Codact/Hyperlite payload over AG-UI.
- A browser client can render it without out-of-band assumptions.
- The contract specifies security boundaries and user approval expectations.
