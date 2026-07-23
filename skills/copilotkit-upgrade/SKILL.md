---
name: copilotkit-upgrade
description: "Use when migrating a CopilotKit v1 application to v2 -- updating package imports, replacing deprecated hooks and components, switching from GraphQL runtime to AG-UI protocol runtime, and resolving breaking API changes."
version: 1.0.1
---

# CopilotKit v1 to v2 Migration Skill

## Live Documentation (MCP)

This plugin includes an MCP server (`copilotkit-docs`) that provides `search-docs` and `search-code` tools for querying live CopilotKit documentation and source code. Useful for looking up current v2 API signatures during migration.

- **Claude Code:** Auto-configured by the plugin's `.mcp.json` -- no setup needed.
- **Codex:** Requires manual configuration. See the [copilotkit-debug skill](../copilotkit-debug/SKILL.md#mcp-setup) for setup instructions.

## Overview

CopilotKit v2 is a ground-up rewrite built on the AG-UI protocol (`@ag-ui/client` / `@ag-ui/core`). Users continue to install and import `@copilotkit/*` packages -- the v2 changes are exposed through the same package names (under their `/v2` subpaths) with updated APIs (new hook names, component names, runtime configuration). The underlying `@ag-ui/*` packages are an internal implementation detail re-exported through `@copilotkit/react-core/v2`, so users never need to install them directly.

## Migration Workflow

### 1. Audit Current Usage

Scan the codebase for all v1 imports and API usage:

```
@copilotkit/react-core    -> hooks, CopilotKit provider, types
@copilotkit/react-ui      -> CopilotChat, CopilotPopup, CopilotSidebar
@copilotkit/react-textarea -> CopilotTextarea (removed in v2)
@copilotkit/runtime       -> CopilotRuntime, service adapters, framework integrations
@copilotkit/runtime-client-gql -> GraphQL client, message types
@copilotkit/shared         -> utility types, constants
@copilotkit/sdk-js         -> LangGraph/LangChain SDK
```

### 2. Identify Deprecated APIs

Key hooks and components to find and replace:

| v1 API                             | v2 Replacement                                             |
| ---------------------------------- | ---------------------------------------------------------- |
| `useCopilotAction`                 | `useFrontendTool`                                          |
| `useCopilotReadable`               | `useAgentContext`                                          |
| `useCopilotChat`                   | `useAgent`                                                 |
| `useCoAgent`                       | `useAgent`                                                 |
| `useCoAgentStateRender`            | `useRenderTool` / `useRenderActivityMessage`               |
| `useCopilotContext`                | `useCopilotKit` (from `@copilotkit/react-core/v2/context`) |
| `useLangGraphInterrupt`            | `useInterrupt`                                             |
| `useCopilotChatSuggestions`        | `useConfigureSuggestions` + `useSuggestions`               |
| `useCopilotAdditionalInstructions` | `useAgentContext`                                          |
| `useMakeCopilotDocumentReadable`   | `useAgentContext`                                          |
| `CopilotKit` (root import)         | `CopilotKit` (from `@copilotkit/react-core/v2`)            |
| `CopilotTextarea`                  | Removed -- use standard textarea + `useFrontendTool`       |

### 3. Map to v2 Equivalents

Refer to `references/v1-to-v2-migration.md` for detailed before/after code examples.

### 4. Update Package Dependencies

The `@copilotkit/*` package names stay the same. v2 does **not** introduce new package names -- the v2 APIs ship from the **`/v2` subpath** of the existing packages (`@copilotkit/react-core/v2`, `@copilotkit/runtime/v2`). There is no `@copilotkit/react` or `@copilotkit/agent` package. Update to the latest v2 versions:

```
@copilotkit/react-core         -> @copilotkit/react-core (v2 symbols under the /v2 subpath)
@copilotkit/react-ui           -> chat components move to @copilotkit/react-core/v2; react-ui contributes only styles in v2
@copilotkit/react-textarea     -> removed (no v2 equivalent)
@copilotkit/runtime            -> @copilotkit/runtime (v2 symbols under the /v2 subpath)
@copilotkit/runtime-client-gql -> removed (replaced by AG-UI protocol; @ag-ui/client types are re-exported from @copilotkit/react-core/v2)
@copilotkit/shared             -> @copilotkit/shared (same package)
@copilotkit/sdk-js             -> removed (BuiltInAgent now ships from @copilotkit/runtime/v2)
```

### 5. Update Runtime Configuration

The v1 `CopilotRuntime` accepted service adapters (OpenAI, Anthropic, LangChain, etc.) and endpoint definitions. The v2 `CopilotRuntime` accepts AG-UI `AbstractAgent` instances directly.

**v1 pattern** (service adapter + endpoints):

```ts
import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";
const runtime = new CopilotRuntime({ actions: [...] });
// used with framework handlers like copilotRuntimeNextJSAppRouterEndpoint() (Next.js), etc.
```

**v2 pattern** (agents + Hono endpoint):

```ts
import {
  CopilotRuntime,
  BuiltInAgent,
  createCopilotHonoHandler,
} from "@copilotkit/runtime/v2";
const runtime = new CopilotRuntime({
  agents: { myAgent: new BuiltInAgent({ model: "openai/gpt-4o" }) },
});
const app = createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });
```

> Use `createCopilotHonoHandler` (from `@copilotkit/runtime/v2`) as the canonical Hono endpoint factory. `createCopilotEndpoint` is a **deprecated** alias for it -- avoid it in new code. For Express, use `createCopilotExpressHandler` from `@copilotkit/runtime/v2/express` (`createCopilotEndpointExpress` is its deprecated alias).

### 6. Update Provider

The provider component keeps the name `CopilotKit` -- only the import path changes. The package root (`@copilotkit/react-core`) is the legacy v1 provider; the `/v2` subpath is the migration target.

**v1 (root import):**

```tsx
import { CopilotKit } from "@copilotkit/react-core";
<CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>;
```

**v2 (`/v2` import):**

```tsx
import { CopilotKit } from "@copilotkit/react-core/v2";
<CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>;
```

> **Note:** `@copilotkit/react-core/v2` also exports a `CopilotKitProvider` component. Do **not** migrate to it -- it is a functionality subset of `CopilotKit`, which is the compatibility bridge across v1 and v2 and accepts every `CopilotKitProvider` prop.

### 7. Verify

- Run the application and check for runtime errors
- Verify all agent interactions work (chat, tool calls, interrupts)
- Check that tool renderers display correctly
- Confirm suggestions load and display

## Quick Reference

| Concept              | v1                                              | v2                                                                                 |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| Package scope        | `@copilotkit/*`                                 | `@copilotkit/*` (same scope, updated APIs)                                         |
| Protocol             | GraphQL                                         | AG-UI (SSE)                                                                        |
| Provider component   | `CopilotKit` (from `@copilotkit/react-core`)    | `CopilotKit` (from `@copilotkit/react-core/v2`)                                    |
| Define frontend tool | `useCopilotAction`                              | `useFrontendTool`                                                                  |
| Share app state      | `useCopilotReadable`                            | `useAgentContext`                                                                  |
| Agent interaction    | `useCoAgent`                                    | `useAgent`                                                                         |
| Handle interrupts    | `useLangGraphInterrupt`                         | `useInterrupt`                                                                     |
| Render tool calls    | `useCopilotAction({ render })`                  | `useFrontendTool({ render })` or `useRenderTool` (render-only)                     |
| Chat suggestions     | `useCopilotChatSuggestions`                     | `useConfigureSuggestions`                                                          |
| Runtime class        | `CopilotRuntime` (adapters)                     | `CopilotRuntime` (agents, from `@copilotkit/runtime/v2`)                           |
| Endpoint setup       | `copilotRuntimeNextJSAppRouterEndpoint()`       | `createCopilotHonoHandler()` (`createCopilotEndpoint` is a deprecated alias)       |
| Agent definition     | `LangGraphAgent` endpoint                       | `AbstractAgent` / `BuiltInAgent` (from `@copilotkit/runtime/v2`)                   |
| Chat components      | `CopilotChat`, `CopilotPopup`, `CopilotSidebar` | `CopilotChat`, `CopilotPopup`, `CopilotSidebar` (from `@copilotkit/react-core/v2`) |
