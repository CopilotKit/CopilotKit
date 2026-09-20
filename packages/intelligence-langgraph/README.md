# CopilotKit Intelligence skills for LangGraph

Keep one Learning container's published skills available to native TypeScript LangChain agents. The adapter adds an alphabetical catalog and two read tools; the model decides when to use a skill.

Requires Node.js 20.19+, LangChain 1.5.11+, LangGraph 1.4.14+, and LangChain core 1.2.10+ within major version 1. The Intelligence server must expose the learned-snapshot API, and the canonical Runtime client must include that operation.

## Setup

```typescript
import { createAgent } from "langchain";
import {
  SkillRegistry,
  createSkillRegistryMiddleware,
} from "@copilotkit/intelligence-langgraph";

// CPK_INTELLIGENCE_API_KEY and CPK_INTELLIGENCE_LEARNING_CONTAINER_ID
// configure the registry. Set INTELLIGENCE_API_URL for self-hosting.
const registry = new SkillRegistry();
await registry.initialize();
const skills = createSkillRegistryMiddleware({ registry });
const agent = skills.wrapAgent(
  createAgent({
    model: "your-provider:your-model",
    systemPrompt: "Follow our support policy.",
    middleware: [skills],
  }),
);

const result = await agent.invoke({
  messages: [{ role: "user", content: "Help with a refund" }],
});
```

The wrapper is required for affected framework versions. It keeps one immutable snapshot outside checkpoints for each invocation, including streams and resumed runs. After a native framework fix passes the same lifecycle tests, middleware-only setup will become the default; the wrapper will be optional and existing wrapped agents will remain supported.

Use the wrapped agent's `invoke`, `stream`, or `streamEvents`, including native `Command` resumes. `withConfig` retains the wrapper. Apply default cancellation signals after wrapping, or pass a signal to the invocation. Native stream readers and cancellation remain available; graph batching is unsupported. Register and wrap each selected agent explicitly.

## Configuration and errors

Pass an existing `CopilotKitIntelligence` client from `@copilotkit/runtime/v2` as `new SkillRegistry({ client, containerId })` to reuse its credentials and transport. Your application retains ownership of that client. Explicit options override environment values; an injected client is authoritative for connection configuration.

`freshnessWindowMs` and `requestTimeoutMs` default to 5000; `debug` defaults to false. Set `revision` or `CPK_INTELLIGENCE_SKILLS_REVISION` for an exact whole-container pin. Startup initialization is optional: the first wrapped invocation initializes automatically. Initialization and invocation errors are catchable as `SkillDeliveryError`.

`registry.status` reports initialization, revision, last successful check, stale state, and a safe last error. Warm transient failures retain the prior snapshot; confirmed denial blocks new invocations. Running invocations finish with their captured snapshot. The adapter performs no retry, disk writes, or script execution.

Both `copilotkit_load_skill` and `copilotkit_read_skill_file` remain registered for an empty container. Developer instructions retain precedence over learned skills. Unsupported file content and unknown names or paths use native tool errors.

See the [learned skill delivery guide](https://docs.copilotkit.ai/intelligence/learned-skills) for managed/self-hosted setup, release prerequisites, and migration from CLI downloads.
