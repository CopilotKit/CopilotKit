# CopilotKit for Angular

Angular bindings for CopilotKit core and AG-UI agents. This package provides services, directives, and utilities for building custom, headless Copilot UIs.

## Installation

```bash
# npm
npm install @copilotkitnext/{core,angular}
```

- `@angular/core` and `@angular/common` (19+)
- `@angular/cdk` (match your Angular major)
- `rxjs`

## Quick start

### 1) Provide CopilotKit

Configure runtime and tools in your app config:

```ts
import { ApplicationConfig } from "@angular/core";
import { provideCopilotKit } from "@copilotkitnext/angular";

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
import { CopilotKit, injectAgentStore } from "@copilotkitnext/angular";
import { randomUUID } from "@copilotkitnext/shared";

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
  properties?: Record<string, unknown>;
  agents?: Record<string, AbstractAgent>;
  tools?: ClientTool[];
  renderToolCalls?: RenderToolCallConfig[];
  frontendTools?: FrontendToolConfig[];
  humanInTheLoop?: HumanInTheLoopConfig[];
}
```

- `runtimeUrl`: URL to your CopilotKit runtime.
- `headers`: Default headers sent to the runtime.
- `properties`: Arbitrary props forwarded to agent runs.
- `agents`: Local, in-browser agents keyed by `agentId`.
- `tools`: Tool definitions advertised to the runtime (no handler).
- `renderToolCalls`: Components to render tool calls in the UI.
- `frontendTools`: Client-side tools with handlers.
- `humanInTheLoop`: Tools that pause for user input.

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
import { connectAgentContext } from "@copilotkitnext/angular";

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
} from "@copilotkitnext/angular";
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

## Not documented here

This package also exports a full set of chat UI components under `src/lib/components/chat`. Those APIs are intentionally omitted from this README.
