# CopilotKit for Angular

Angular bindings for CopilotKit core and AG-UI agents. This package provides services, directives, and utilities for building custom (headless) Copilot UIs, plus optional chat UI components (not documented here per request).

> Note: This README intentionally omits all APIs defined under `src/lib/components/chat`.

## Installation

```bash
# pnpm (recommended)
pnpm add @copilotkitnext/angular

# npm
npm install @copilotkitnext/angular

# yarn
yarn add @copilotkitnext/angular
```

### Peer dependencies

- `@angular/core` and `@angular/common` (Angular 18 or 19)
- `@angular/cdk` (match your Angular major)
- `rxjs`
- `tslib`

### Styles (optional)

If you use the bundled chat UI components, include the stylesheet:

```json
"styles": [
  "@copilotkitnext/angular/styles.css",
  "src/styles.css"
]
```

Or in a global stylesheet:

```css
@import "@copilotkitnext/angular/styles.css";
```

## Quick start (headless)

### 1) Provide CopilotKit

Configure runtime and tools in your app config:

```ts
import { ApplicationConfig, importProvidersFrom } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { provideCopilotKit } from "@copilotkitnext/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(BrowserModule),
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
import { Component, computed, signal } from "@angular/core";
import { injectAgentStore } from "@copilotkitnext/angular";

@Component({
  standalone: true,
  template: `
    <div>
      <div *ngFor="let msg of messages()">
        <strong>{{ msg.role }}:</strong> {{ msg.content }}
      </div>

      <input
        [value]="input()"
        (input)="input.set($any($event.target).value)"
        (keyup.enter)="send()"
      />
      <button (click)="send()" [disabled]="isRunning()">Send</button>
    </div>
  `,
})
export class HeadlessChatComponent {
  private store = injectAgentStore("default");
  messages = computed(() => this.store().messages());
  isRunning = computed(() => this.store().isRunning());
  input = signal("");

  async send() {
    const content = this.input().trim();
    if (!content) return;

    const agent = this.store().agent;
    agent.addMessage({ role: "user", content });
    this.input.set("");
    await agent.runAgent();
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
- `injectCopilotKitConfig()`: Read the injected config.
- `COPILOT_KIT_CONFIG`: Injection token.

## `CopilotKit` service

The main service that wraps `@copilotkitnext/core`.

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

### `CopilotKitAgentContext` directive

Template-friendly context binding:

```html
<div copilotkitAgentContext [description]="'Form state'" [value]="formValue"></div>

<div [copilotkitAgentContext]="{ description: 'User', value: user }"></div>
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
  handler: (args: Args) => Promise<unknown>;
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
import { registerFrontendTool, registerRenderToolCall, registerHumanInTheLoop } from "@copilotkitnext/angular";
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
  frontendTools: [/* FrontendToolConfig[] */],
  renderToolCalls: [/* RenderToolCallConfig[] */],
  humanInTheLoop: [/* HumanInTheLoopConfig[] */],
  tools: [/* ClientTool[] */],
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

## Chat labels

Although chat UI components are not documented here, you can customize their labels:

```ts
import { provideCopilotChatLabels } from "@copilotkitnext/angular";

providers: [
  provideCopilotChatLabels({
    chatInputPlaceholder: "Ask me anything...",
    chatDisclaimerText: "AI can be wrong. Verify critical info.",
  }),
];
```

API:

- `CopilotChatLabels`: label interface
- `COPILOT_CHAT_DEFAULT_LABELS`: default values
- `COPILOT_CHAT_LABELS`: injection token
- `injectChatLabels()`: resolves labels (defaults if none provided)
- `provideCopilotChatLabels(partial)`: provider

## `ChatState`

`ChatState` is an abstract injectable used by chat inputs. If you build your own input, you can implement and provide `ChatState` to child components.

```ts
export abstract class ChatState {
  abstract readonly inputValue: WritableSignal<string>;
  abstract submitInput(value: string): void;
  abstract changeInput(value: string): void;
}
```

Use `injectChatState()` to read it; it throws if no parent provides the state.

## Slots

The slot utilities provide a small, typed slot system that works with templates or components.

### `CopilotSlot` component

```html
<copilot-slot
  [slot]="customTemplateOrComponent"
  [context]="{ label: 'Save' }"
  [defaultComponent]="DefaultButton"
  [outputs]="{ click: onClick }"
>
  <!-- default content shown if no slot/default component -->
</copilot-slot>
```

### Utilities

- `renderSlot(viewContainer, options)`: Render a slot (template or component).
- `createSlotConfig(overrides, defaults)`: Build a slot registry map.
- `provideSlots(slots)`: Provide DI overrides (components only).
- `getSlotConfig()`: Read the DI slot registry.
- `createSlotRenderer(defaultComponent, slotName?)`: Pre-configured renderer.
- `normalizeSlotValue`, `isSlotValue`, `isComponentType`: helpers.

### Types

- `SlotValue`, `SlotConfig`, `SlotContext`, `SlotRegistryEntry`, `RenderSlotOptions`, `WithSlots`

## Directives

### `CopilotKitAgentContext`

See **Agent context** above.

### `StickToBottom`

Directive: `copilotStickToBottom`.

Inputs:

- `enabled` (default `true`)
- `threshold` (pixels from bottom, default `10`)
- `initialBehavior` (`"smooth" | "instant" | "auto"`, default `"smooth"`)
- `resizeBehavior` (same as above, default `"smooth"`)
- `debounceMs` (default `100`)

Outputs:

- `isAtBottomChange: EventEmitter<boolean>`
- `scrollToBottomRequested: EventEmitter<void>`

Public methods (via template ref):

- `scrollToBottom(behavior?: ScrollBehavior)`
- `isAtBottom()`
- `getScrollState()`

Example:

```html
<div
  copilotStickToBottom
  [enabled]="true"
  (isAtBottomChange)="isAtBottom = $event"
>
  <div data-stick-to-bottom-content>
    <!-- messages -->
  </div>
</div>

<button (click)="scrollToBottom()">Jump to bottom</button>
```

```ts
import { Component, ViewChild } from "@angular/core";
import { StickToBottom } from "@copilotkitnext/angular";

@Component({ /* ... */ })
export class MessagesComponent {
  @ViewChild(StickToBottom) stickToBottom?: StickToBottom;

  scrollToBottom() {
    this.stickToBottom?.scrollToBottom("smooth");
  }
}
```

### `CopilotTooltip`

Directive: `copilotTooltip`.

Inputs:

- `copilotTooltip`: tooltip text
- `tooltipPosition`: `"above" | "below" | "left" | "right"` (default `"below"`)
- `tooltipDelay`: milliseconds (default `500`)

Example:

```html
<button copilotTooltip="Copy" tooltipPosition="above">Copy</button>
```

## Services

### `ScrollPosition`

- `monitorScrollPosition(element, threshold?) => Observable<ScrollState>`
- `scrollToBottom(element, smooth?)`
- `isAtBottom(element, threshold?)`
- `getScrollState(element, threshold)`
- `observeResize(element, debounceMs?) => Observable<ResizeObserverEntry>`

### `ResizeObserverService`

- `observeElement(element, debounceMs?, resizingDurationMs?) => Observable<ResizeState>`
- `unobserve(element)`
- `getCurrentSize(element)`
- `getCurrentState(element)`

## Utilities

### `cn(...inputs)`

Merge class name strings using `clsx` + `tailwind-merge`.

## Runtime notes

- Set `runtimeUrl` to your CopilotKit runtime endpoint.
- If you need to change runtime settings at runtime, call `CopilotKit.updateRuntime(...)`.
- `runtimeTransport` supports `"rest"` or `"single"` (SSE single-stream transport).

## Not documented here

This package also exports a full set of chat UI components under `src/lib/components/chat`. Those APIs are intentionally omitted from this README.
