# CloudPlot

An AI-powered AWS infrastructure architect built with CopilotKit V2 and LangGraph. Design simulated cloud architectures through natural conversation while the agent visualizes resources in real-time.

![CloudPlot Demo](public/og-image.png)

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up local environment files
cp .env.example .env.local
cp agent/.env.example agent/.env
# Then replace OPENAI_API_KEY in agent/.env with your OpenAI API key.

# Start dev server (UI + Agent)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and start designing: *"Build a 3-tier web app with VPC, load balancer, and RDS"*

## What This Demo Shows

CloudPlot demonstrates CopilotKit V2 APIs for building production-grade AI applications. The infrastructure actions are simulation-only; the demo does not call AWS APIs or use AWS credentials.

| Feature | V2 API Used | What It Enables |
|---------|-------------|-----------------|
| Real-time canvas updates | `useAgent` + state sync | Agent changes appear instantly on canvas |
| Generative UI cards | `useFrontendTool` | Rich tool call visualization in chat |
| Approval workflows | `useHumanInTheLoop` | HITL for high-risk infrastructure changes |
| Conversation branching | `CopilotSidebar` + `threadId` | Explore alternatives without losing work |
| Tool execution logs | Event subscriptions | Track agent reasoning and actions |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Next.js Frontend                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐     ┌──────────────────────────────────┐  │
│  │  CopilotSidebar  │     │          Canvas (React Flow)     │  │
│  │                  │     │  ┌─────┐ ┌─────┐ ┌─────┐         │  │
│  │  - Chat UI       │     │  │ VPC │─│ EC2 │─│ RDS │         │  │
│  │  - Tool cards    │     │  └─────┘ └─────┘ └─────┘         │  │
│  │  - HITL approval │     │                                  │  │
│  └────────┬─────────┘     └──────────────────────────────────┘  │
│           │                            ▲                         │
│           │                            │                         │
│           ▼                            │                         │
│  ┌─────────────────────────────────────┴─────────────────────┐  │
│  │                    useCloudPlotAgent                       │  │
│  │  - useAgent (state sync)                                   │  │
│  │  - Event subscriptions (onStateChanged, onRunFinalized)    │  │
│  │  - Branch state management                                 │  │
│  └─────────────────────────────────────┬─────────────────────┘  │
│                                        │                         │
├────────────────────────────────────────┼────────────────────────┤
│  Hooks Layer                           │                         │
│  ┌──────────────────┐  ┌───────────────┴──────┐  ┌───────────┐  │
│  │ useFrontendTools │  │   useBranchManager   │  │useInfraApp│  │
│  │ - ResourceCard   │  │   - Branch CRUD      │  │  roval    │  │
│  │ - ConnectionCard │  │   - State persistence│  │  - HITL   │  │
│  └──────────────────┘  └──────────────────────┘  └───────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LangGraph Agent (Python)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  AgentState:                                                     │
│  ├─ nodes: AWSResourceNode[]     (VPC, EC2, RDS, Lambda, etc.)  │
│  ├─ edges: Connection[]          (resource relationships)       │
│  ├─ logs: ThoughtLogEntry[]      (agent activity log)           │
│  ├─ cost: number                 (estimated monthly cost)       │
│  ├─ status: AgentStatus          (idle, planning, building...)  │
│  └─ validation_errors: Error[]   (architecture issues)          │
│                                                                  │
│  Graph Nodes:          Tools:                                    │
│  ┌─────────┐           ├─ add_resource                          │
│  │ router  │──┬───────▶├─ connect_resources                     │
│  └─────────┘  │        ├─ remove_resource                       │
│               ▼        ├─ update_resource                       │
│  ┌─────────────────┐   ├─ validate_architecture                 │
│  │   chat_node     │   └─ estimate_cost                         │
│  └────────┬────────┘                                             │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │   tool_node     │ ◀── State enrichment after each tool       │
│  └────────┬────────┘                                             │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │cost_estimator   │ ◀── Calculates infrastructure costs        │
│  └─────────────────┘                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## CopilotKit V2 Features In Depth

### 1. useAgent Hook — Real-time State Sync

The `useAgent` hook connects React to the LangGraph agent's state. When the agent adds a VPC or EC2 instance, the canvas updates immediately.

```typescript
// src/hooks/useCloudPlotAgent.ts
import { useAgent } from "@copilotkit/react-core/v2";

export function useCloudPlotAgent() {
  const { agent } = useAgent({ agentId: "cloudplot_agent" });

  // State is automatically synced from LangGraph
  const state = agent.state as CloudPlotAgentState;

  // Update state (syncs back to agent)
  const setState = (newState: CloudPlotAgentState) => {
    agent.setState(newState);
  };

  return { state, setState, agent };
}
```

**Why this matters:** Traditional approaches require polling or WebSocket plumbing. CopilotKit V2 handles bidirectional state sync out of the box.

### 2. Event Subscriptions — React to Agent Activity

Subscribe to agent lifecycle events for logging, notifications, and UI updates:

```typescript
useEffect(() => {
  const subscriber = {
    onRunStartedEvent: () => setIsRunning(true),
    onRunFinalized: () => {
      setIsRunning(false);
      showNotification("Agent completed");
    },
    onStateChanged: (newState) => {
      reactFlowInstance?.fitView({ padding: 0.2 });
    },
    onToolCallEndEvent: ({ toolCallName, toolCallArgs }) => {
      // Log tool executions to thought panel
      addToLog({ tool: toolCallName, args: toolCallArgs });
    },
  };

  const { unsubscribe } = agent.subscribe(subscriber);
  return () => unsubscribe();
}, [agent]);
```

**Why this matters:** Event subscriptions enable reactive UIs that respond to agent behavior without polling.

### 3. useFrontendTool — Generative UI

Display rich cards in the chat when the agent calls tools:

```typescript
// src/hooks/useFrontendTools.tsx
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

useFrontendTool({
  name: "add_resource",
  description: "Add AWS resource to architecture",
  parameters: z.object({
    resource_type: z.string(),
    name: z.string(),
    config: z.record(z.any()).optional(),
  }),
  render: ({ args, status }) => (
    <ResourceCard
      type={args.resource_type}
      name={args.name}
      status={status}
    />
  ),
});
```

**Why this matters:** Instead of plain text tool responses, users see interactive cards with icons, status indicators, and details.

### 4. useHumanInTheLoop — Approval Workflows

Require human approval for high-risk infrastructure changes:

```typescript
// src/hooks/useInfraApproval.tsx
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";

useHumanInTheLoop({
  name: "approve_infrastructure",
  description: "Request approval for infrastructure changes",
  parameters: z.object({
    action: z.string(),
    resources: z.array(z.string()),
    cost_impact: z.string(),
    risk_level: z.enum(["low", "medium", "high"]),
  }),
  render: ({ args, respond }) => (
    <ApprovalCard
      action={args.action}
      resources={args.resources}
      cost_impact={args.cost_impact}
      risk_level={args.risk_level}
      onApprove={() => respond("approved")}
      onReject={() => respond("rejected")}
    />
  ),
});
```

**Why this matters:** Production AI apps need guardrails. HITL patterns let humans stay in control of critical decisions.

### 5. Conversation Branching with threadId

Fork conversations to explore alternatives without losing your current work:

```typescript
// Pass threadId to CopilotSidebar for conversation isolation
<CopilotSidebar
  agentId="cloudplot_agent"
  threadId={currentBranch.threadId}  // Each branch has unique thread
/>

// Branch manager handles state persistence per branch
const { branches, createBranch, switchBranch } = useBranchManager();
```

**Why this matters:** Architects often want to compare approaches. Branching lets them try "What if we use serverless?" without losing the current design.

---

## Project Structure

```
├── agent/
│   └── main.py              # LangGraph agent with 6 tools
├── src/
│   ├── app/
│   │   └── page.tsx         # Main page with Canvas + Chat
│   ├── components/
│   │   ├── Canvas.tsx       # React Flow canvas
│   │   ├── nodes/           # Custom AWS resource nodes
│   │   ├── ApprovalCard.tsx # HITL approval UI
│   │   ├── ResourceCard.tsx # Generative UI for add_resource
│   │   └── ...
│   ├── hooks/
│   │   ├── useCloudPlotAgent.ts    # Agent state + events
│   │   ├── useFrontendTools.tsx    # Generative UI registration
│   │   ├── useInfraApproval.tsx    # HITL hook
│   │   └── useBranchManager.ts     # Branch state persistence
│   └── types/
│       └── index.ts         # TypeScript interfaces
```

---

## Available Scripts

```bash
pnpm dev           # Start UI + Agent (concurrently)
pnpm dev:ui        # Start Next.js only
pnpm dev:agent     # Start LangGraph agent only
pnpm build         # Production build
pnpm lint          # ESLint check
pnpm test          # Deterministic fixture and safety tests
```

---

## Building Real Apps with These Patterns

### Pattern 1: Shared State for Visual Builders

Any app where an AI modifies a visual canvas benefits from CopilotKit's state sync:
- Diagram editors (architecture, flowcharts, ERDs)
- Design tools (UI mockups, slide decks)
- Data pipeline builders

### Pattern 2: Tool Call Visualization

Use `useFrontendTool` whenever tool execution benefits from rich feedback:
- Code generation (show file diffs)
- API calls (show request/response)
- Database operations (show affected rows)

### Pattern 3: Human-in-the-Loop for Sensitive Operations

Wrap high-impact actions with `useHumanInTheLoop`:
- Database schema changes
- External API calls with side effects
- Actions that incur costs

### Pattern 4: Event-Driven UI Updates

Use event subscriptions to keep UI responsive:
- Progress indicators during long operations
- Auto-scroll chat on new messages
- Canvas auto-fit when resources added

---

## Requirements

- Node.js 20.9+
- Python 3.12+
- OpenAI API key

## Railway deployment

Deploy Cloudplot as two services from the same merged CopilotKit revision:

| Service | Root directory | Required variables |
| --- | --- | --- |
| Frontend | `examples/showcases/cloudplot` | `LANGGRAPH_DEPLOYMENT_URL`; optional `LANGSMITH_API_KEY`; platform `PORT` |
| Agent | `examples/showcases/cloudplot/agent` | `OPENAI_API_KEY`; platform `PORT` |

Set `LANGGRAPH_DEPLOYMENT_URL` on the frontend to the agent service URL after the agent is deployed. Do not configure AWS keys; Cloudplot intentionally keeps deployment actions simulated.
Railway probes the frontend at `GET /api/health` and the LangGraph Agent Server's built-in health endpoint at `GET /ok`, which returns `{"ok":true}`.

## Troubleshooting

**Agent not responding?**
- Check `agent/.env` has valid `OPENAI_API_KEY`
- Verify agent is running on port 8123 locally or that `LANGGRAPH_DEPLOYMENT_URL` points to the deployed agent service

**Canvas not updating?**
- Check browser console for React Flow errors
- Ensure `useCloudPlotAgent` hook is properly connected

## License

MIT

Built by Mark Morgan
