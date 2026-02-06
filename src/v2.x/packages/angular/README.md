# CopilotKit for Angular

This package provides native Angular components, directives, and providers to build Copilot chat UIs powered by the CopilotKit runtime and AG-UI agents. It mirrors the React experience with idiomatic Angular APIs.

## Quick Start

1. **Install**: `pnpm add @copilotkitnext/angular`
2. **Add styles**: Add `@copilotkitnext/angular/styles.css` to your Angular app styles array or `@import "@copilotkitnext/angular/styles.css";` in a global stylesheet
3. **Provide CopilotKit**: Set the runtime URL and optional labels via providers
4. **Use the chat**: Drop `<copilot-chat></copilot-chat>` into any template

## Installation

### Package Installation

Install `@copilotkitnext/angular` in your Angular app (supports Angular 19):

```bash
# pnpm (recommended)
pnpm add @copilotkitnext/angular

# npm
npm install @copilotkitnext/angular

# yarn
yarn add @copilotkitnext/angular
```

### Peer Dependencies

Ensure these are present (Angular 19 required):

- `@angular/core`
- `@angular/common`
- `@angular/cdk` (use `^19`)
- `rxjs`
- `tslib`

### Styles

Reference the package CSS so the components render correctly.

**Option 1 –** In `angular.json` (use the path that resolves for your build; the demo uses the built `dist` path):

```json
"styles": [
  "node_modules/@copilotkitnext/angular/dist/styles.css",
  "src/styles.css"
]
```

**Option 2 –** In your global stylesheet:

```css
@import "@copilotkitnext/angular/styles.css";
```

## App Wiring (Providers)

Add CopilotKit providers in your application config to set the runtime URL, optional tool renderers, and chat labels.

### Example (`app.config.ts`)

Minimal setup:

```typescript
import { ApplicationConfig, importProvidersFrom } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import {
  provideCopilotKit,
  provideCopilotChatLabels,
} from "@copilotkitnext/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(BrowserModule),
    provideCopilotKit({
      runtimeUrl: "http://localhost:3001/api/copilotkit",
      // runtimeUrl can also be set via template directive; see below
    }),
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask me anything...",
      chatDisclaimerText: "AI responses may need verification.",
    }),
  ],
};
```

Full demo-style setup (with tool call renderers):

```typescript
import { ApplicationConfig, importProvidersFrom } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import {
  provideCopilotKit,
  provideCopilotChatLabels,
} from "@copilotkitnext/angular";
import { WildcardToolRenderComponent } from "./components/wildcard-tool-render.component";

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(BrowserModule),
    provideCopilotKit({
      runtimeUrl: "http://localhost:3001/api/copilotkit",
      renderToolCalls: [
        { name: "*", component: WildcardToolRenderComponent } as any,
      ],
      frontendTools: [],
      humanInTheLoop: [],
    }),
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask me anything...",
      chatDisclaimerText: "CopilotKit Angular Demo - AI responses may need verification.",
    }),
  ],
};
```

## Runtime URL (Template Directive)

You can declare the CopilotKit runtime endpoint directly in templates via the `CopilotKitConfigDirective`.

### Component Template Example:

```html
<div
  [copilotkitConfig]="{ runtimeUrl: runtimeUrl }"
  style="display:block;height:100vh"
>
  <copilot-chat></copilot-chat>
</div>
```

### Component Class:

```typescript
export class AppComponent {
  runtimeUrl = "http://localhost:3001/api/copilotkit";
}
```

## Using the Chat Component

Import `CopilotChat` from `@copilotkitnext/angular` and use the `<copilot-chat>` selector in your template.

### Minimal usage

```html
<copilot-chat></copilot-chat>
```

### With optional inputs

```html
<!-- Default agent, optional thread id -->
<copilot-chat [threadId]="'xyz'"></copilot-chat>

<!-- Specific agent -->
<copilot-chat [agentId]="'sales'"></copilot-chat>

<!-- Both -->
<copilot-chat [agentId]="'sales'" [threadId]="'thread-1'"></copilot-chat>
```

### Behavior

- If `agentId` is omitted, the component uses the default agent (ID: `default`).
- `threadId` optionally scopes the conversation to a given thread.

## Custom Input Components (Angular)

To use a custom chat input, inject `ChatState` via `injectChatState()` and pass your input component to `<copilot-chat>` with the `inputComponent` input. The chat provides `ChatState` to its children, so your custom input can call `submitInput(value)` and `changeInput(value)`.

### Custom input component example

```typescript
import { Component, inject, Input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { injectChatState } from "@copilotkitnext/angular";

@Component({
  selector: "my-custom-input",
  standalone: true,
  imports: [FormsModule],
  template: `
    <form (ngSubmit)="submit()" [class.disabled]="inProgress">
      <input
        [(ngModel)]="value"
        (ngModelChange)="chatState.changeInput($event)"
        [disabled]="inProgress"
        placeholder="Ask anything…"
        (keydown.enter)="$event.preventDefault(); submit()"
      />
      <button type="submit" [disabled]="inProgress || !value.trim()">Send</button>
    </form>
  `,
})
export class MyCustomInputComponent {
  @Input() inProgress = false; // optional: set by chat when agent is running
  value = "";
  readonly chatState = injectChatState();

  submit() {
    const trimmed = this.value.trim();
    if (trimmed) {
      this.chatState.submitInput(trimmed);
      this.value = "";
    }
  }
}
```

### Using the custom input with `<copilot-chat>`

```typescript
import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotChat } from "@copilotkitnext/angular";
import { MyCustomInputComponent } from "./my-custom-input.component";

@Component({
  selector: "app-chat",
  standalone: true,
  imports: [CommonModule, CopilotChat],
  template: `
    <copilot-chat [inputComponent]="customInput"></copilot-chat>
  `,
})
export class ChatComponent {
  customInput = MyCustomInputComponent;
}
```

### Key points

- **ChatState**: Use `injectChatState()` inside any child of `<copilot-chat>` to get `submitInput(value)` and `changeInput(value)`.
- **inputComponent**: Pass the component type (e.g. `MyCustomInputComponent`) to `<copilot-chat [inputComponent]="...">` so the chat uses your input instead of the default.

### Component-level labels

You can override labels for a specific chat by providing `provideCopilotChatLabels` in that component’s `providers` (the demo’s custom-input chat does this):

```typescript
import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { CopilotChat, provideCopilotChatLabels } from "@copilotkitnext/angular";
import { CustomChatInputComponent } from "./custom-chat-input.component";

@Component({
  selector: "nextgen-custom-input-chat",
  standalone: true,
  imports: [CommonModule, CopilotChat],
  template: `<copilot-chat [inputComponent]="customInput"></copilot-chat>`,
  providers: [
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask anything...",
      chatDisclaimerText: "AI can make mistakes. Verify important info.",
    }),
  ],
})
export class CustomInputChatComponent {
  customInput = CustomChatInputComponent;
}
```

## Agents 101 (AG-UI)

- **Agent model**: CopilotKit uses AG-UI's `AbstractAgent` interface (package `@ag-ui/client`)
- **Frontend vs backend**:
  - **Backend (runtime)**: Host your real agents. You can use any AG-UI agent on the server
  - **Frontend (Angular app)**: Discovers remote agents from the runtime automatically, and can also host local in-browser agents if desired
- **Default agent**: The ID `default` is special; when present, it is used by `<copilot-chat>` if no `agentId` is provided
- **Compatibility**: Any agent that supports AG-UI works. See https://docs.ag-ui.com/

> **Note**: In most real apps, you define agents on the server (runtime). The frontend will auto-discover them when a `runtimeUrl` is configured.

## Backend Runtime (Hono Server)

The Angular demo uses a Hono server in `apps/angular/demo-server`. Example:

### `index.ts`

```typescript
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkitnext/runtime";
import { OpenAIAgent, SlowToolCallStreamingAgent } from "@copilotkitnext/demo-agents";

const runtime = new CopilotRuntime({
  agents: {
    default: new SlowToolCallStreamingAgent(),
    openai: new OpenAIAgent(),
  },
  runner: new InMemoryAgentRunner(),
});

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "http://localhost:4200",
    allowMethods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposeHeaders: ["Content-Type"],
    credentials: true,
    maxAge: 86400,
  })
);

const copilotApp = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

app.route("/", copilotApp);

const port = Number(process.env.PORT || 3001);
serve({ fetch: app.fetch, port });
console.log(`CopilotKit runtime listening at http://localhost:${port}/api/copilotkit`);
```

## CopilotKit Angular APIs (Most Used)

### Components

- **`CopilotChat`** (selector: `copilot-chat`): Full chat UI
  - Inputs: `agentId?: string`, `threadId?: string`, `inputComponent?: Type<unknown>`

### Directives

- **`CopilotKitConfigDirective`** (`[copilotkitConfig]`): Set `runtimeUrl`, `headers`, `properties`, and/or `agents` declaratively
- **`CopilotKitAgentDirective`** (`[copilotkitAgent]`): Observe agent state; defaults to the `default` agent if no `agentId` is provided

### Providers

- **`provideCopilotKit(...)`**: Set runtime URL, headers, properties, agents, `renderToolCalls`, `frontendTools`, `humanInTheLoop`
- **`provideCopilotChatLabels(...)`**: Set UI labels for chat input and messages (placeholder, disclaimer, toolbar labels, etc.)

## Headless Usage: Building Custom Chat UIs

For full control over the chat UI, use `injectAgentStore(agentId)` to get a reactive store (signals for `agent`, `messages`, `isRunning`), then render messages and tool calls yourself. The demo implements this in `apps/angular/demo` (headless route).

### Using `injectAgentStore` for a custom chat

Inject an agent store by agent ID, then use the store’s `agent`, `messages()`, and `isRunning()` in your template and send logic:

```typescript
import { Component, computed, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  injectAgentStore,
  CopilotKit,
  RenderToolCalls,
} from "@copilotkitnext/angular";

@Component({
  selector: "headless-chat",
  standalone: true,
  imports: [CommonModule, FormsModule, RenderToolCalls],
  template: `
    <div class="headless-container" style="display:flex;flex-direction:column;height:100vh;">
      <div class="messages" style="flex:1;overflow:auto;padding:16px;">
        <div *ngFor="let m of messages()">
          <div>{{ m.role | titlecase }}</div>
          <div style="white-space:pre-wrap">{{ m.content }}</div>
          <ng-container *ngIf="m.role === 'assistant'">
            <copilot-render-tool-calls
              [message]="m"
              [messages]="messages() ?? []"
              [isLoading]="isRunning()"
            />
          </ng-container>
        </div>
        <div *ngIf="isRunning()">Thinking…</div>
      </div>
      <form (ngSubmit)="send()" style="display:flex;gap:8px;padding:12px;">
        <input
          name="message"
          [(ngModel)]="inputValue"
          [disabled]="isRunning()"
          placeholder="Type a message…"
        />
        <button type="submit" [disabled]="!inputValue.trim() || isRunning()">Send</button>
      </form>
    </div>
  `,
})
export class HeadlessChatComponent {
  readonly agentStore = injectAgentStore("openai"); // or "default"
  readonly agent = computed(() => this.agentStore()?.agent);
  readonly isRunning = computed(() => !!this.agentStore()?.isRunning());
  readonly messages = computed(() => this.agentStore()?.messages() ?? []);
  private readonly copilotkit = inject(CopilotKit);

  inputValue = "";

  async send() {
    const content = this.inputValue.trim();
    const agent = this.agent();
    if (!agent || !content || this.isRunning()) return;

    agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
    this.inputValue = "";
    await this.copilotkit.core.runAgent({ agent });
  }
}
```

- **`injectAgentStore(agentId)`**: Returns a `Signal<AgentStore | undefined>`. Use `agentStore()?.agent`, `agentStore()?.messages()`, `agentStore()?.isRunning()` (or wrap in `computed` as above).
- **`<copilot-render-tool-calls>`**: Renders tool calls for an assistant message; requires `[message]`, `[messages]`, and `[isLoading]`. Import the `RenderToolCalls` standalone component/directive.
- **Sending**: Add a user message with `agent.addMessage(...)` then run with `copilotkit.core.runAgent({ agent })`.

### Optional: human-in-the-loop and agent context

You can register human-in-the-loop tools and connect agent context in the same (or a parent) component:

```typescript
import { registerHumanInTheLoop, connectAgentContext } from "@copilotkitnext/angular";
import { z } from "zod";

// In constructor or field initializer:
registerHumanInTheLoop({
  name: "requireApproval",
  description: "Requires human approval before proceeding",
  parameters: z.object({ action: z.string(), reason: z.string() }),
  component: RequireApprovalComponent,
});

connectAgentContext(signal({ value: "voice-mode", description: "active" }));
```

### Rendering tool calls (headless)

1. **Register tool renderers** in app config (see [App Wiring](#app-wiring-providers)). Each renderer implements `ToolRenderer<Args>` with a single input `toolCall: Signal<AngularToolCall<Args>>` (or use `input.required<AngularToolCall<any>>()`). Example wildcard renderer (as in the demo):

```typescript
import { Component, input } from "@angular/core";
import { CommonModule } from "@angular/common";
import { AngularToolCall, ToolRenderer } from "@copilotkitnext/angular";

@Component({
  selector: "wildcard-tool-render",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="padding:12px;margin:8px 0;background:#f5f5f5;border-radius:8px;">
      <div style="font-weight:bold;">🔧 Tool Execution</div>
      <pre>{{ toolCall().args | json }}</pre>
      <div>Output: {{ toolCall().result }}</div>
    </div>
  `,
})
export class WildcardToolRenderComponent implements ToolRenderer {
  readonly toolCall = input.required<AngularToolCall<any>>();
}
```

Register it in `provideCopilotKit({ renderToolCalls: [{ name: "*", component: WildcardToolRenderComponent } as any] })`. The `as any` is often needed for wildcard configs because `RenderToolCallConfig` expects an `args` zod schema.

2. **Use `<copilot-render-tool-calls>`** in your headless template for each assistant message, as in the example above. It will pick the right renderer (including the `"*"` fallback) and pass the correct `toolCall` input to your component.

### Benefits of headless usage

- Full control over layout and styling
- Reactive signals from `injectAgentStore` for agent, messages, and loading state
- Same tool and human-in-the-loop registration as the full chat component

## End-to-End: Running the Demo

From the repo root (`src/v2.x` or monorepo root):

1. **Install deps**: `pnpm install`
2. **Start both demo server and Angular demo app**: `pnpm build && pnpm demo:angular`
   - Frontend: http://localhost:4200 (default chat at `/`, headless at `/headless`, custom input at `/custom-input`)
   - Backend: http://localhost:3001/api/copilotkit
3. **Prerequisite**: Set `OPENAI_API_KEY` in `apps/angular/demo-server/.env` for the OpenAI/demo agents

## Building This Monorepo

- **Full build**: `pnpm build` (compiles all packages including Angular)
- **Clean**: `pnpm clean`
- **Package-only dev (watch)**: `pnpm dev`

## Angular Storybook

### Dev Server

```bash
pnpm storybook:angular
```

- Serves Storybook for Angular components on http://localhost:6007
- For live chat stories, ensure the demo server is running so the chat can connect:
  ```bash
  pnpm --filter @copilotkitnext/angular-demo-server dev
  ```

### Production Build

```bash
pnpm -C apps/angular/storybook build
```

## Notes

- Node 18+ and pnpm 9+ recommended
- If using custom CORS or non-default ports, update `runtimeUrl` and server CORS settings accordingly
- Styles must be included for proper rendering; if customizing CSS, prefer overriding classes instead of modifying the distributed CSS
