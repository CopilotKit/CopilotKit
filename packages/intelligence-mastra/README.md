# CopilotKit Intelligence skills for Mastra

Keep a Learning container's published skills available to Mastra agents. The adapter adds a catalog and two native read tools. Each invocation uses one verified snapshot, including tool-first resumes.

Requires Node.js 22.13+ and Mastra core `>=1.0.0 <2`. The Intelligence server and canonical Runtime client must support the learned-snapshot API.

## Setup

```typescript
import { Agent } from "@mastra/core/agent";
import {
  SkillRegistry,
  createSkillRegistryProcessor,
} from "@copilotkit/intelligence-mastra";

// Set CPK_INTELLIGENCE_API_KEY and CPK_INTELLIGENCE_LEARNING_CONTAINER_ID.
// Set INTELLIGENCE_API_URL for a self-hosted Intelligence server.
const registry = new SkillRegistry();
await registry.initialize();
const skills = createSkillRegistryProcessor({ registry });
const agent = skills.wrapAgent(
  new Agent({
    id: "support",
    name: "Support",
    model: "openai/gpt-4.1",
    instructions: "Follow our support policy.",
    inputProcessors: [skills],
    tools: { ...skills.tools },
  }),
);

const result = await agent.generate("Help with a refund.");
```

Register other processors and tools in the same native arrays and maps. Reserve `copilotkit_load_skill` and `copilotkit_read_skill_file` for this adapter. Both tools remain available for an empty registry. Host instructions retain precedence over learned content.

## Execution and resume

Call the wrapped Agent for `generate`, `stream`, `resumeGenerate`, and `resumeStream`. The wrapper also covers the native approval helpers: `approveToolCall`, `declineToolCall`, `approveToolCallGenerate`, and `declineToolCallGenerate` where the installed Mastra version provides them.

Each call acquires its snapshot before native execution. Streaming results retain Mastra's native shape. A resume starts a new invocation and captures the current snapshot. Private async context carries that snapshot, so restored tools cannot read an older snapshot from a suspended closure. Snapshots are not stored in request context or processor state.

Pass `abortSignal` in the invocation options to cancel the delivery wait and native execution. A signal supplied only through Agent `defaultOptions` takes effect during native execution and cannot cancel the preceding delivery wait. Cancelling one caller does not cancel a registry refresh shared with other callers. Register and wrap each selected agent explicitly; subagent propagation follows Mastra. Agent networks, legacy methods, background workers, and separate durable-worker dispatch are outside this adapter's supported entry points.

## Configuration

Pass an application-owned `CopilotKitIntelligence` client from `@copilotkit/runtime/v2` to `new SkillRegistry({ client, containerId })` to reuse its credentials and HTTP transport. Explicit configuration overrides environment values. An injected client is authoritative for connection configuration.

`freshnessWindowMs` and `requestTimeoutMs` default to 5000. `debug` defaults to false. Set `revision` or `CPK_INTELLIGENCE_SKILLS_REVISION` for an exact whole-container pin. Explicit initialization is optional; the first wrapped invocation can initialize the registry.

Catch `SkillDeliveryError` during initialization or invocation. Its stable `code` describes the failure. Warm transient errors retain the previous verified snapshot; confirmed denial blocks new invocations. `registry.status` exposes initialization, revision, mode, freshness, and safe error status.

The adapter reads skills in memory and does not write files or execute scripts. The model chooses whether to load or follow skills. The package uses the canonical Runtime client and retains that client's dependency footprint; it does not depend on the LangGraph adapter.

See the [learned skill delivery guide](https://docs.copilotkit.ai/intelligence/learned-skills) for server requirements and migration from CLI downloads.
