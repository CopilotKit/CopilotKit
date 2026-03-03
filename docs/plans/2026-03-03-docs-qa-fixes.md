# Docs QA Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all documentation code examples that have incorrect imports, wrong API signatures, or missing dependencies — based on QA triage at `docs/plans/2026-03-03-docs-qa-issue-triage.md`.

**Architecture:** The docs use MDX files in `docs/content/docs/integrations/` (per-integration pages) and `docs/snippets/shared/` (reusable snippets). Most integration pages have **inline code** — fixing shared snippets alone won't cover everything. Each fix is a mechanical find-and-replace within code blocks.

**Tech Stack:** MDX documentation, TypeScript/React code examples

**Scope:** Categories 1-3 and 6 from the triage (doc fixes only). Categories 4-5 (CLI, runtime bugs) are documented but not fixed here. **Tutorials are excluded** (e.g., `tutorials/ai-todo-app/`, `tutorials/agent-native-app/`).

---

## Fix Patterns Reference

These patterns are used repeatedly across tasks. Refer back here.

### Pattern A: Remove `/v2` from `CopilotKit` imports

```diff
- import { CopilotKit } from "@copilotkit/react-core/v2";
+ import { CopilotKit } from "@copilotkit/react-core";
```

### Pattern B: `useCopilotReadable` → `useAgentContext`

```diff
- import { useCopilotReadable } from "@copilotkit/react-core/v2";
+ import { useAgentContext } from "@copilotkit/react-core/v2";

- useCopilotReadable({
-   description: "The current todo list",
-   value: todos,
- });
+ useAgentContext({
+   description: "The current todo list",
+   value: todos,
+ });
```

### Pattern C: `useDefaultTool` → `useDefaultRenderTool`

```diff
- import { useDefaultTool } from "@copilotkit/react-core/v2";
+ import { useDefaultRenderTool } from "@copilotkit/react-core/v2";

- useDefaultTool({
+ useDefaultRenderTool({
```

### Pattern D: `useLangGraphInterrupt` → `useInterrupt`

```diff
- import { useLangGraphInterrupt } from "@copilotkit/react-core/v2";
+ import { useInterrupt } from "@copilotkit/react-core/v2";

- useLangGraphInterrupt({
+ useInterrupt({
```

### Pattern E: `useAgent` — fix destructuring and remove type params

```diff
- const { agentState } = useAgent<AgentState>({
-   agentId: "myAgent",
- });
- console.log(agentState.someField);
+ const { agent } = useAgent({
+   agentId: "myAgent",
+ });
+ console.log(agent.state?.someField);
```

For state rendering callbacks:
```diff
- useAgent<AgentState>({
-   agentId: "myAgent",
-   render: ({ agentState }) => (
-     <div>{agentState.someField}</div>
-   ),
- });
+ // useAgent does not have a render callback in V2.
+ // Use useRenderTool or useComponent for rendering patterns.
+ const { agent } = useAgent({ agentId: "myAgent" });
```

> **Important:** `useAgent` in V2 does NOT accept `render` callbacks or type parameters. It returns `{ agent: AbstractAgent }`. Access state via `agent.state`. The render patterns need to be replaced with the appropriate V2 hook (`useComponent`, `useRenderTool`, etc.) depending on the use case. Check each page's context to determine the right replacement.

### Pattern F: `useRenderToolCall` → `useRenderTool`

The docs incorrectly use `useRenderToolCall` with config arguments. V2's `useRenderToolCall` takes **0 arguments**. The correct hook for rendering specific tool calls is `useRenderTool`:

```diff
- import { useRenderToolCall } from "@copilotkit/react-core/v2";
+ import { useRenderTool } from "@copilotkit/react-core/v2";

- useRenderToolCall({
-   name: "getWeather",
-   render: ({ args, status }) => (
-     <WeatherCard location={args.location} loading={status === "loading"} />
-   ),
- });
+ useRenderTool({
+   name: "getWeather",
+   render: ({ args, status }) => (
+     <WeatherCard location={args.location} loading={status === "loading"} />
+   ),
+ });
```

### Pattern G: `useFrontendTool` — fix parameter types and handler signature

```diff
- useFrontendTool({
-   name: "greet",
-   parameters: [
-     { name: "name", type: "string", description: "The name", required: true },
-   ],
-   handler: ({ name }) => `Hello ${name}`,
- });
+ useFrontendTool({
+   name: "greet",
+   parameters: z.object({
+     name: z.string().describe("The name"),
+   }),
+   handler: async ({ name }) => {
+     return `Hello ${name}`;
+   },
+ });
```

Note: `handler` must return `Promise<unknown>`, and `parameters` must be a Zod schema. Add `import { z } from "zod";` if missing.

---

## Task 1: Fix shared snippets (high leverage)

Fixing these files automatically fixes all integration pages that import them.

**Files:**
- Modify: `docs/snippets/shared/generative-ui/display-only.mdx` — `useComponent` import (verify correct)
- Modify: `docs/snippets/shared/generative-ui/tool-rendering.mdx` — verify `useRenderTool` usage
- Modify: `docs/snippets/shared/app-control/frontend-tools.mdx` — fix `useFrontendTool` params (Pattern G)
- Modify: `docs/snippets/shared/guides/default-tool-rendering.mdx` — `useDefaultTool` → `useDefaultRenderTool` (Pattern C)
- Modify: `docs/snippets/shared/basics/programmatic-control.mdx` — verify `useAgent` pattern (Pattern E)
- Modify: `docs/snippets/shared/premium/observability.mdx` — `CopilotKit` import (Pattern A)
- Modify: `docs/snippets/shared/reference/copilotkit-component.mdx` — `CopilotKit` import (Pattern A)
- Modify: `docs/snippets/landing-code-showcase.mdx` — `CopilotKit` import (Pattern A)

**Step 1:** Read each file, apply the relevant pattern from the reference above.

**Step 2:** Commit shared snippet fixes.

```bash
git add docs/snippets/
git commit -m "fix(docs): update shared snippets to correct V2 API patterns"
```

---

## Task 2: Fix `CopilotKit` V2 imports across integration pages

Apply **Pattern A** to all integration pages importing `CopilotKit` from `/v2`.

**Files (check each — some may already be fixed by Task 1 snippets):**
- Modify: `docs/content/docs/integrations/built-in-agent/quickstart.mdx`
- Modify: `docs/content/docs/integrations/langgraph/quickstart.mdx` (FastAPI + LangSmith variants — check for tabbed content)
- Modify: `docs/content/docs/integrations/mastra/quickstart.mdx`
- Modify: `docs/content/docs/integrations/langgraph/deep-agents.mdx`
- Modify: `docs/content/docs/integrations/microsoft-agent-framework/quickstart.mdx` (.NET)
- Modify: `docs/content/docs/integrations/aws-strands/quickstart.mdx`
- Modify: Any other pages found by grepping: `grep -r "CopilotKit.*react-core/v2" docs/content/`

**Step 1:** For each file, change `@copilotkit/react-core/v2` → `@copilotkit/react-core` on lines importing `CopilotKit`.

**Step 2:** Commit.

```bash
git add docs/content/
git commit -m "fix(docs): import CopilotKit from V1 path across integration pages"
```

---

## Task 3: Fix `useCopilotReadable` → `useAgentContext`

Apply **Pattern B** to all files.

**Files:**
- Modify: `docs/content/docs/integrations/microsoft-agent-framework/agent-app-context.mdx` (line 30)
- Modify: `docs/content/docs/integrations/ag2/readables.mdx` (lines 46, 164)
- Modify: `docs/content/docs/integrations/mastra/agent-app-context.mdx` (line 28)
- ~~Skip: `built-in-agent/tutorials/*` (tutorials out of scope)~~

**Step 1:** In each file, replace the import and all `useCopilotReadable` calls with `useAgentContext`.

**Step 2:** Commit.

```bash
git add docs/content/
git commit -m "fix(docs): replace useCopilotReadable with useAgentContext (V2 equivalent)"
```

---

## Task 4: Fix `useDefaultTool` → `useDefaultRenderTool`

Apply **Pattern C**.

**Files:**
- Modify: `docs/snippets/shared/guides/default-tool-rendering.mdx` (line 8) — **already covered in Task 1, skip if done**
- Modify: `docs/content/docs/integrations/langgraph/deep-agents.mdx` (line 289)

**Step 1:** Replace import and hook call name.

**Step 2:** Commit.

```bash
git add docs/
git commit -m "fix(docs): replace useDefaultTool with useDefaultRenderTool (V2 equivalent)"
```

---

## Task 5: Fix `useLangGraphInterrupt` → `useInterrupt`

Apply **Pattern D**.

**Files:**
- Modify: `docs/content/docs/integrations/langgraph/human-in-the-loop/interrupt-flow.mdx` (lines 180, 299, 362)
- ~~Skip: `langgraph/tutorials/*` (tutorials out of scope)~~

**Step 1:** Replace import and all `useLangGraphInterrupt` calls with `useInterrupt`. Check that the callback shape matches — `useInterrupt` uses `{ render, handler?, enabled?, agentId?, renderInChat? }`.

**Step 2:** Commit.

```bash
git add docs/content/
git commit -m "fix(docs): replace useLangGraphInterrupt with useInterrupt (V2 equivalent)"
```

---

## Task 6: Fix `useAgent` destructuring and type params

Apply **Pattern E** across all integration pages. This is the largest task.

**Files (18+ pages):**
- Modify: `docs/content/docs/integrations/mastra/generative-ui/state-rendering.mdx`
- Modify: `docs/content/docs/integrations/mastra/shared-state/in-app-agent-read.mdx`
- Modify: `docs/content/docs/integrations/llamaindex/generative-ui/state-rendering.mdx`
- Modify: `docs/content/docs/integrations/llamaindex/shared-state/in-app-agent-read.mdx`
- Modify: `docs/content/docs/integrations/llamaindex/shared-state/predictive-state-updates.mdx`
- Modify: `docs/content/docs/integrations/crewai-flows/shared-state/in-app-agent-read.mdx`
- Modify: `docs/content/docs/integrations/crewai-flows/shared-state/predictive-state-updates.mdx`
- Modify: `docs/content/docs/integrations/aws-strands/generative-ui/state-rendering.mdx`
- Modify: `docs/content/docs/integrations/aws-strands/shared-state/in-app-agent-read.mdx`
- Modify: `docs/content/docs/integrations/aws-strands/shared-state/in-app-agent-write.mdx`
- Modify: `docs/content/docs/integrations/microsoft-agent-framework/generative-ui/state-rendering.mdx`
- Modify: `docs/content/docs/integrations/microsoft-agent-framework/shared-state/in-app-agent-read.mdx`
- Modify: `docs/content/docs/integrations/microsoft-agent-framework/shared-state/in-app-agent-write.mdx`
- Modify: `docs/content/docs/integrations/microsoft-agent-framework/shared-state/predictive-state-updates.mdx`
- Modify: `docs/content/docs/integrations/adk/generative-ui/state-rendering.mdx`
- Modify: `docs/content/docs/integrations/adk/shared-state/in-app-agent-read.mdx`
- Modify: `docs/content/docs/integrations/adk/shared-state/in-app-agent-write.mdx`
- Modify: `docs/snippets/crew-quickstart.mdx`

**Step 1:** For each file:
1. Remove `<AgentState>` type parameter from `useAgent<AgentState>(...)`
2. Change `{ agentState }` / `{ agentState, setAgentState }` to `{ agent }`
3. Replace `agentState.field` with `agent.state?.field`
4. For `render` callbacks on `useAgent` — these don't exist in V2. Read the surrounding context to determine the correct V2 pattern (likely `useComponent` or separate state display logic).
5. For `setAgentState(...)` — replace with `agent.setState(...)` if available, or document the V2 equivalent.

**Step 2:** Commit.

```bash
git add docs/
git commit -m "fix(docs): update useAgent pattern to V2 API (agent.state instead of agentState)"
```

---

## Task 7: Fix `useRenderToolCall` → `useRenderTool`

Apply **Pattern F** across all tool rendering pages.

**Files (9 pages):**
- Modify: `docs/content/docs/integrations/agno/generative-ui/tool-rendering.mdx` (line 91)
- Modify: `docs/content/docs/integrations/mastra/generative-ui/tool-rendering.mdx` (line 97)
- Modify: `docs/content/docs/integrations/microsoft-agent-framework/generative-ui/tool-rendering.mdx` (line 131)
- Modify: `docs/content/docs/integrations/llamaindex/generative-ui/tool-rendering.mdx` (line 105)
- Modify: `docs/content/docs/integrations/pydantic-ai/generative-ui/tool-rendering.mdx` (line 87)
- Modify: `docs/content/docs/integrations/adk/generative-ui/tool-rendering.mdx` (line 104)
- Modify: `docs/content/docs/integrations/agent-spec/generative-ui/tool-rendering.mdx` (line 136)
- Modify: `docs/content/docs/integrations/ag2/generative-ui/tool-rendering.mdx` (line 91)
- Modify: `docs/content/docs/integrations/aws-strands/generative-ui/tool-rendering.mdx` (lines 111, 181)

**Step 1:** Replace `useRenderToolCall({...})` with `useRenderTool({...})` — same config shape, just different hook name.

**Step 2:** For AWS Strands specifically, also fix `parameters: [...]` array → Zod schema.

**Step 3:** Commit.

```bash
git add docs/content/
git commit -m "fix(docs): replace useRenderToolCall with useRenderTool across tool rendering pages"
```

---

## Task 8: Fix `useFrontendTool` parameter types

Apply **Pattern G** across frontend tools pages.

**Files:**
- Modify: `docs/content/docs/integrations/mastra/app-control/frontend-tools.mdx`
- Modify: `docs/content/docs/integrations/agno/app-control/frontend-tools.mdx`
- Modify: `docs/content/docs/integrations/microsoft-agent-framework/app-control/frontend-tools.mdx` (.NET and Python — check if separate files)
- Modify: `docs/content/docs/integrations/aws-strands/app-control/frontend-tools.mdx`
- Modify: `docs/snippets/shared/app-control/frontend-tools.mdx` — **already covered in Task 1, skip if done**

**Step 1:** For each file:
1. Replace `parameters: [{ name, type, description, required }]` with `parameters: z.object({...})`
2. Add `import { z } from "zod";` if missing
3. Fix handler to return `Promise<unknown>` (add `async` and ensure return)

**Step 2:** Commit.

```bash
git add docs/
git commit -m "fix(docs): update useFrontendTool to use Zod schemas and async handlers"
```

---

## Task 9: Fix missing dependencies

**Files:**
- Modify: `docs/content/docs/integrations/mastra/quickstart.mdx`

**Step 1:** Add `@ai-sdk/openai` to the install command in the quickstart.

**Step 2:** Commit.

```bash
git add docs/content/
git commit -m "fix(docs): add missing @ai-sdk/openai dependency to Mastra quickstart"
```

---

## Task 10: Verify — build docs site

**Step 1:** Run the docs build to check for any remaining errors.

```bash
nx run docs:build
```

**Step 2:** If errors remain, fix them and commit.

**Step 3:** Final commit if needed.

---

## Not in scope (documented in triage only)

These are captured in `docs/plans/2026-03-03-docs-qa-issue-triage.md` for the team:

- **Tutorials** — all `tutorials/` subdirectories (e.g., `ai-todo-app`, `agent-native-app`, `ai-powered-textarea`)
- **Cat 4:** CLI `create` command missing `built-in-agent` and `agent-spec` framework options
- **Cat 5:** Runtime issues — ADK `useAgent` resolution bug, LangGraph graph nullish, AWS Strands `Agent.__init__()` kwargs, LibSQLStore config, CrewAI Pydantic warning, A2A spawn path
