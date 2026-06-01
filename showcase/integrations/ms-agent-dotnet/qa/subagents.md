# QA: Sub-Agents — Microsoft Agent Framework (.NET)

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- .NET agent backend is healthy (`/api/health`); `GitHubToken` (or equivalent) is set so the OpenAI client can authenticate; the `/subagents` AG-UI endpoint is mounted in `agent/Program.cs`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with the delegation log on the left and the `CopilotChat` pane on the right
- [ ] Verify `data-testid="delegation-log"` is visible with heading "Delegation log" and an empty-state message reading "No delegations yet. Ask the supervisor to plan a deliverable."
- [ ] Verify the chat input placeholder is "Ask the supervisor to plan, draft, or critique..."
- [ ] Verify both suggestion pills are visible with verbatim titles: "Quick brief", "Marketing post"
- [ ] Send "Hello! What can you do?"; verify an assistant reply appears within 10s describing the three sub-agents

### 2. Feature-Specific Checks

#### Single Sub-Agent Delegation

- [ ] Send "Use the research sub-agent to give me 3 facts about pair programming."; within 30s verify a `data-testid="delegation-entry"` is rendered with `data-status="completed"`, the "Research" badge, and a non-empty result body containing 3 bullet-style lines
- [ ] Verify the assistant chat reply summarizes the research result in one or two short sentences

#### Live Running -> Completed Transition

- [ ] Click the "Quick brief" suggestion; immediately observe the delegation log
- [ ] Verify at least one `data-testid="delegation-entry"` appears with `data-status="running"`, the spinner is visible, and the "Sub-agent is working…" message is shown
- [ ] Within 60s verify the same entry transitions to `data-status="completed"` and the spinner is replaced with the actual result text
- [ ] Verify subsequent delegations append additional entries (the list grows; earlier entries are not removed)

#### Sequential Pipeline (Research -> Write -> Critique)

- [ ] Click the "Marketing post" suggestion; within 90s verify the delegation log contains at least 3 `data-testid="delegation-entry"` rows in this order: Research, Writing, Critique
- [ ] Verify each entry's `data-status` ends as `completed` (no `failed` rows under normal conditions)
- [ ] Verify the assistant chat reply concisely summarizes the work and references the critique output

#### Failure Path (Optional / Best Effort)

- [ ] If you can intentionally provoke an upstream failure (e.g. revoke the API key briefly, or disable network egress for the .NET backend container), trigger a delegation; verify the entry's `data-status="failed"` and the failure message is rendered in red
- [ ] Verify the assistant surfaces the failure briefly to the user instead of fabricating a result

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no assistant response, no new delegation entries)
- [ ] Send a non-task message ("hi"); verify the agent responds without invoking any sub-agent (no new delegation entries appear)
- [ ] Verify DevTools -> Console shows no uncaught errors during any flow above

## Expected Results

- Page loads within 3 seconds
- Single-sub-agent delegations complete within 30 seconds; full Research -> Write -> Critique chains complete within 90 seconds
- Each delegation row shows a visible `running` -> `completed` (or `failed`) transition; the running spinner is rendered while the secondary chat-client call is in flight
- Failed sub-agent calls are reported as `failed` rows with a structured error message — never silently turned into `completed` rows with garbage results
- No UI layout breaks, no uncaught console errors
