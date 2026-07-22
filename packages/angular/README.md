# CopilotKit for Angular

First-party Angular bindings for CopilotKit core and AG-UI agents. The package
ships standalone chat, popup, and sidebar components as well as signal-based
headless APIs, tool and activity renderers, threads, memories, interrupts,
attachments, A2UI, Open Generative UI, and opt-in MCP Apps support.

## Installation

```bash
# npm
npm install @copilotkit/angular
```

Peer dependencies you provide in your app:

- `@angular/core` and `@angular/common` (20, 21, or 22)
- `@angular/cdk` (match your Angular major)
- `rxjs` 7.8 or newer

The exact versions exercised by the packed-consumer release matrix are stored
in `package.json` under `copilotkit.angularSupport`. The library is compiled at
the Angular 20 support floor and installed with strict peer checking against
all three supported majors.

## Quick start

### 1) Provide CopilotKit

Configure runtime and tools in your app config:

```ts
import { ApplicationConfig } from "@angular/core";
import { provideCopilotKit } from "@copilotkit/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    provideCopilotKit({
      runtimeUrl: "http://localhost:3001/api/copilotkit",
      headers: { Authorization: "Bearer ..." },
      properties: { app: "demo" },
    }),
  ],
};
```

### 2) Build a custom UI with `injectAgentStore`

```ts
import { Component, inject, signal } from "@angular/core";
import { Message } from "@ag-ui/client";
import { CopilotKit, injectAgentStore } from "@copilotkit/angular";
import { randomUUID } from "@copilotkit/shared";

@Component({
  template: `
    @for (let message of messages(); track message.id) {
      <div>
        <em>{{ message.role }}</em>
        <p>{{ message.content }}</p>
      </div>
    }

    <input
      [value]="input()"
      (input)="input.set($any($event.target).value)"
      (keyup.enter)="send()"
    />
    <button (click)="send()" [disabled]="store().isRunning()">Send</button>
  `,
})
export class HeadlessChatComponent {
  readonly copilotKit = inject(CopilotKit);
  readonly store = injectAgentStore("default");
  readonly messages = this.store().messages;

  readonly input = signal("");

  async send() {
    const content = this.input().trim();
    if (!content) return;

    const agent = this.store().agent;

    agent.addMessage({
      id: randomUUID(),
      role: "user",
      content,
    });

    this.input.set("");

    await this.copilotKit.core.runAgent({ agent });
  }
}
```

The `agent` is an AG-UI `AbstractAgent`. Refer to your AG-UI agent implementation for available methods and message formats.

## Core configuration

### `CopilotKitConfig`

`provideCopilotKit` accepts a `CopilotKitConfig` object:

```ts
export interface CopilotKitConfig {
  runtimeUrl?: string;
  headers?: Record<string, string>;
  licenseKey?: string;
  properties?: Record<string, unknown>;
  agents?: Record<string, AbstractAgent>;
  selfManagedAgents?: Record<string, AbstractAgent>;
  tools?: ClientTool[];
  renderToolCalls?: RenderToolCallConfig[];
  renderActivityMessages?: RenderActivityMessageConfig[];
  suggestionsConfig?: SuggestionsConfig[];
  frontendTools?: FrontendToolConfig[];
  humanInTheLoop?: HumanInTheLoopConfig[];
  defaultToolRendering?: boolean;
  a2ui?: A2UIConfig;
  openGenerativeUI?: OpenGenerativeUIConfig;
}
```

- `runtimeUrl`: URL to your CopilotKit runtime.
- `headers`: Default headers sent to the runtime.
- `properties`: Arbitrary props forwarded to agent runs.
- `agents`: Local, in-browser agents keyed by `agentId`.
- `selfManagedAgents`: AG-UI agents managed directly by the application.
- `tools`: Tool definitions advertised to the runtime (no handler).
- `renderToolCalls`: Components to render tool calls in the UI.
- `renderActivityMessages`: Components to render AG-UI activity messages.
- `suggestionsConfig`: Static or runtime-generated chat suggestions.
- `frontendTools`: Client-side tools with handlers.
- `humanInTheLoop`: Tools that pause for user input.
- `defaultToolRendering`: Opt in to the text-only renderer for unknown tools.
  It is disabled by default so missing renderers remain visible integration
  errors rather than silently changing the experience.
- `a2ui`: Theme, catalog, schema, loading UI, and recovery policy for A2UI.
- `openGenerativeUI`: Sandboxed UI functions and optional design guidance.

### Injection helpers

- `provideCopilotKit(config)`: Provider for `CopilotKitConfig`.

## `CopilotKit` service

### Readonly signals

- `agents`: `Signal<Record<string, AbstractAgent>>`
- `runtimeConnectionStatus`: `Signal<CopilotKitCoreRuntimeConnectionStatus>`
- `runtimeUrl`: `Signal<string | undefined>`
- `runtimeTransport`: `Signal<CopilotRuntimeTransport>` (`"rest" | "single"`)
- `headers`: `Signal<Record<string, string>>`
- `toolCallRenderConfigs`: `Signal<RenderToolCallConfig[]>`
- `clientToolCallRenderConfigs`: `Signal<FrontendToolConfig[]>`
- `humanInTheLoopToolRenderConfigs`: `Signal<HumanInTheLoopConfig[]>`

### Methods

- `getAgent(agentId: string): AbstractAgent | undefined`
- `addFrontendTool(config: FrontendToolConfig & { injector: Injector }): void`
- `addRenderToolCall(config: RenderToolCallConfig): void`
- `addHumanInTheLoop(config: HumanInTheLoopConfig): void`
- `removeTool(toolName: string, agentId?: string): void`
- `updateRuntime(options: { runtimeUrl?: string; runtimeTransport?: CopilotRuntimeTransport; headers?: Record<string,string>; properties?: Record<string, unknown>; agents?: Record<string, AbstractAgent>; }): void`

### Advanced

- `core`: The underlying `CopilotKitCore` instance.

## Agents

### `injectAgentStore`

```ts
const store = injectAgentStore("default");
// or: injectAgentStore(signal(agentId))
```

Returns a `Signal<AgentStore>`. The store exposes:

- `agent`: `AbstractAgent`
- `messages`: `Signal<Message[]>`
- `state`: `Signal<any>`
- `isRunning`: `Signal<boolean>`
- `teardown()`: Clean up subscriptions

If the agent is not available locally but a `runtimeUrl` is configured, a proxy agent is created while the runtime connects. If the agent still cannot be resolved, an error is thrown that includes the configured runtime and known agent IDs.

### `CopilotkitAgentFactory`

Advanced factory for creating `AgentStore` signals. Most apps should use `injectAgentStore` instead.

## Agent context

### `connectAgentContext`

Connect AG-UI context to the runtime (auto-cleanup when the effect is destroyed):

```ts
import { connectAgentContext } from "@copilotkit/angular";

connectAgentContext({
  description: "User preferences",
  value: { theme: "dark" },
});
```

You must call it within an injection context (e.g., inside a component constructor or `runInInjectionContext`), or pass an explicit `Injector`:

```ts
connectAgentContext(contextSignal, { injector });
```

## Tools and tool rendering

### Types

```ts
export interface RenderToolCallConfig<Args> {
  name: string;              // tool name, or "*" for wildcard
  args: z.ZodType<Args>;      // Zod schema for args
  component: Type<ToolRenderer<Args>>;
  agentId?: string;           // optional agent scope
}

export interface FrontendToolConfig<Args> {
  name: string;
  description: string;
  parameters: z.ZodType<Args>;
  component?: Type<ToolRenderer<Args>>; // optional UI renderer
  handler: (args: Args, context: FrontendToolHandlerContext) => Promise<unknown>;
  agentId?: string;
}

export interface HumanInTheLoopConfig<Args> {
  name: string;
  description: string;
  parameters: z.ZodType<Args>;
  component: Type<HumanInTheLoopToolRenderer<Args>>;
  agentId?: string;
}

export type ClientTool<Args> = Omit<FrontendTool<Args>, \"handler\"> & {
  renderer?: Type<ToolRenderer<Args>>;
};
```

Renderer components receive a signal:

```ts
export interface ToolRenderer<Args> {
  toolCall: Signal<AngularToolCall<Args>>;
}

export interface HumanInTheLoopToolRenderer<Args> {
  toolCall: Signal<HumanInTheLoopToolCall<Args>>; // includes respond(result)
}
```

`AngularToolCall` / `HumanInTheLoopToolCall` expose `args`, `status` (`"in-progress" | "executing" | "complete"`), and `result`.

### Register tools with DI

These helpers auto-remove tools when the current injection context is destroyed:
Call them from an injection context (e.g., a component constructor, directive, or `runInInjectionContext`).

```ts
import {
  registerFrontendTool,
  registerRenderToolCall,
  registerHumanInTheLoop,
} from "@copilotkit/angular";
import { z } from "zod";

registerFrontendTool({
  name: "lookup",
  description: "Fetch a record",
  parameters: z.object({ id: z.string() }),
  handler: async ({ id }) => ({ id, ok: true }),
});

registerRenderToolCall({
  name: "*", // wildcard renderer
  args: z.any(),
  component: MyToolCallRenderer,
});

registerHumanInTheLoop({
  name: "approval",
  description: "Request approval",
  parameters: z.object({ reason: z.string() }),
  component: ApprovalRenderer,
});
```

### Configure tools in `provideCopilotKit`

```ts
provideCopilotKit({
  frontendTools: [
    /* FrontendToolConfig[] */
  ],
  renderToolCalls: [
    /* RenderToolCallConfig[] */
  ],
  humanInTheLoop: [
    /* HumanInTheLoopConfig[] */
  ],
  tools: [
    /* ClientTool[] */
  ],
});
```

`tools` are advertised to the runtime. If you include `renderer` + `parameters` on a `ClientTool`, CopilotKit will also register a renderer for tool calls.

## Prebuilt UI

All UI exports are standalone Angular components. Import the component classes
directly and import `@copilotkit/angular/styles.css` once in the application's
global stylesheet.

### Full-page chat

```ts
import { Component } from "@angular/core";
import { CopilotChat } from "@copilotkit/angular";

@Component({
  selector: "app-assistant",
  imports: [CopilotChat],
  template: `<copilot-chat [agentId]="'default'" />`,
})
export class AssistantComponent {}
```

Use `CopilotPopup` for a floating dialog and `CopilotSidebar` for responsive
overlay or docked presentation. Their `open` inputs are model signals, so
`[(open)]` supports controlled application state. Both include focus trapping,
Escape handling, focus restoration, accessible dialog naming, reduced-motion
behavior, and safe-area-aware mobile layouts.

```ts
import { Component, signal } from "@angular/core";
import { CopilotPopup, CopilotSidebar } from "@copilotkit/angular";

@Component({
  imports: [CopilotPopup, CopilotSidebar],
  template: `
    <copilot-popup [(open)]="popupOpen" title="Support assistant" />
    <copilot-sidebar
      [(open)]="sidebarOpen"
      mode="docked"
      position="right"
      title="Workspace assistant"
    />
  `,
})
export class AssistantSurfacesComponent {
  readonly popupOpen = signal(false);
  readonly sidebarOpen = signal(false);
}
```

`CopilotChatView`, message, input, toolbar, button, attachment, and slot
components are supported public customization primitives. See
[`API.md`](./API.md) for the exhaustive export inventory; use the higher-level
components unless you are replacing part of the default composition.

## `RenderToolCalls` component

`RenderToolCalls` renders tool call components under an assistant message based on registered render configs.

```html
<copilot-render-tool-calls
  [message]="assistantMessage"
  [messages]="messages"
  [isLoading]="isRunning"
></copilot-render-tool-calls>
```

Inputs:

- `message`: `AssistantMessage` (must include `toolCalls`)
- `messages`: full `Message[]` list (used to find tool results)
- `isLoading`: whether the agent is currently running

Tool arguments are parsed with `partialJSONParse`, so incomplete JSON during streaming still renders.

## Runtime notes

- Set `runtimeUrl` to your CopilotKit runtime endpoint.
- If you need to change runtime settings at runtime, call `CopilotKit.updateRuntime(...)`.
- `runtimeTransport` supports `"rest"` or `"single"` (SSE single-stream transport).

## Activity renderers and generative UI

Register application activity renderers with `registerRenderActivityMessage`
or the `renderActivityMessages` provider option. Application registrations
take precedence over optional built-ins.

- A2UI is enabled when the runtime advertises the capability or when
  `a2ui.catalog` is supplied. An explicit catalog enables its renderers and
  agent context even when runtime `/info` does not advertise A2UI, matching the
  React provider contract. Configure recovery exposure independently of
  server-provided lifecycle content.
- Open Generative UI is enabled with `openGenerativeUI: { ... }`. Generated UI
  runs in an isolated WebSandbox; expose only narrowly scoped
  `sandboxFunctions` and never place credentials in browser configuration.
- MCP Apps is intentionally a secondary entry point. Add
  `provideMCPApps()` to application providers and import advanced host APIs
  from `@copilotkit/angular/mcp-apps`. MCP resource and tool requests travel
  through the selected AG-UI agent; the browser provider does not accept a
  server URL.

## Lifecycle and cleanup

Call `injectAgentStore`, `connectAgentContext`, `registerFrontendTool`,
`registerRenderToolCall`, `registerRenderActivityMessage`, `injectInterrupt`,
`injectThreads`, and `injectMemories` from an Angular injection context. The
helpers bind subscriptions, effects, timers, runtime registrations, and
observers to the owning `DestroyRef`. Changing a signal-based agent ID tears
down the previous agent subscription before connecting the replacement.

Do not create these helpers in module-level code or cache an injected
controller beyond the lifetime of its injector. `AgentStore.teardown()` is
public for advanced manually constructed stores; stores returned by
`injectAgentStore` are cleaned up automatically and should not need a manual
call.

Application-owned asynchronous work remains application-owned. Cancel fetches
or other side effects started by a frontend-tool handler when its host is
destroyed, and do not resolve an interrupt after its controller has left the
view.

## SSR, hydration, and zoneless Angular

The package is designed for standalone, OnPush, signal-based applications and
is tested with `provideZonelessChangeDetection()`. No Zone.js dependency is
required. Keep application state in signals or Angular outputs so zoneless
change detection can observe updates.

Browser-only DOM setup is deferred to render lifecycle hooks or guarded by the
platform where the package owns it. For SSR and hydration:

- provide the same CopilotKit configuration and initial `open`/`agentId`
  values on the server and first client render;
- do not access returned agents or run tools during server rendering;
- make runtime URLs absolute when the server and browser use different
  origins, or proxy a same-origin `/api/copilotkit` endpoint;
- enable A2UI, Open Generative UI, audio recording, and MCP Apps in the browser;
  their interactive sandboxes, custom elements, media APIs, and iframes become
  active after hydration;
- avoid branching the component tree on `window` before hydration. Use Angular
  platform guards and `afterNextRender` for application-owned browser work.

## Public API contract

[`API.md`](./API.md) lists every supported export from the root and MCP Apps
entry points and identifies the single internal extension token. A package test
compares that inventory to TypeScript's resolved entry-point exports so a new
public symbol cannot be introduced without documentation.
