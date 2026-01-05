# CopilotKit for Angular

This package provides native Angular components, directives, and providers to build Copilot chat UIs powered by the CopilotKit runtime and AG-UI agents. It mirrors the React experience with idiomatic Angular APIs.

## Quick Start

1. **Install**: `pnpm add @copilotkitnext/angular`
2. **Add styles**: Add `@copilotkitnext/angular/styles.css` to your Angular app styles array or `@import "@copilotkitnext/angular/styles.css";` in a global stylesheet
3. **Provide CopilotKit**: Set the runtime URL and optional labels via providers
4. **Use the chat**: Drop `<copilot-chat />` into any template

## Installation

### Package Installation

Install `@copilotkitnext/angular` in your Angular app (supports Angular 18 and 19):

```bash
# pnpm (recommended)
pnpm add @copilotkitnext/angular

# npm
npm install @copilotkitnext/angular

# yarn
yarn add @copilotkitnext/angular
```

### Peer Dependencies

Ensure these are present (matching your Angular major):

- `@angular/core`
- `@angular/common`
- `@angular/cdk` (use `^18` with Angular 18, `^19` with Angular 19)
- `rxjs`
- `tslib`

### Styles

Reference the package CSS so the components render correctly:

**Option 1:** In `angular.json`:

```json
"styles": [
  "@copilotkitnext/angular/styles.css",
  "src/styles.css"
]
```

**Option 2:** In your global stylesheet:

```css
@import "@copilotkitnext/angular/styles.css";
```

## App Wiring (Providers)

Add CopilotKit providers in your application config to set labels and runtime URL.

### Example (`app.config.ts`):

```typescript
import {
  provideCopilotKit,
  provideCopilotChatConfiguration,
} from "@copilotkitnext/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(BrowserModule),
    ...provideCopilotKit({
      // runtimeUrl can also be set via template directive; see below
    }),
    provideCopilotChatConfiguration({
      labels: {
        chatInputPlaceholder: "Ask me anything...",
        chatDisclaimerText: "AI responses may need verification.",
      },
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

### Minimal Usage:

```html
<copilot-chat></copilot-chat>
```

### With a Specific Agent:

```html
<copilot-chat [agentId]="'sales'"></copilot-chat>
```

### Behavior:

- If `agentId` is omitted, the component uses the default agent (ID: `default`)

## Custom Input Components (Angular)

When building custom input components for CopilotKit Angular, use the service-based pattern with `CopilotChatConfigurationService` for message submission. This is the idiomatic Angular approach leveraging dependency injection.

### Service-Based Custom Input Example:

```typescript
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CopilotChatConfigurationService } from '@copilotkitnext/angular';

@Component({
  selector: 'my-custom-input',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="custom-input-wrapper">
      <input 
        [(ngModel)]="inputValue"
        (keyup.enter)="submitMessage()"
        placeholder="Type your message..."
      />
      <button (click)="submitMessage()">Send</button>
    </div>
  `
})
export class MyCustomInputComponent {
  inputValue = '';
  
  constructor(private chat: CopilotChatConfigurationService) {}
  
  submitMessage() {
    const value = this.inputValue.trim();
    if (value) {
      // Use the service to submit the message
      this.chat.submitInput(value);
      this.inputValue = '';
    }
  }
}
```

### Using the Custom Input Component:

```typescript
import { Component } from '@angular/core';
import { CopilotChatViewComponent } from '@copilotkitnext/angular';
import { MyCustomInputComponent } from './my-custom-input.component';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatViewComponent],
  template: `
    <copilot-chat-view
      [messages]="messages"
      [inputComponent]="customInputComponent">
    </copilot-chat-view>
  `
})
export class ChatComponent {
  messages = [];
  customInputComponent = MyCustomInputComponent;
}
```

### Key Points:

- **No callback props**: Unlike React which uses `onSubmitMessage` callbacks, Angular uses dependency injection
- **Service injection**: Inject `CopilotChatConfigurationService` to access `submitInput()`
- **Cross-component communication**: The service handles message submission internally
- **Type safety**: Full TypeScript support with proper type inference

### Alternative: Using the Chat Config Directive

For template-level hooks, you can also use the `copilotkitChatConfig` directive:

```html
<div [copilotkitChatConfig]="{ 
  onSubmitInput: handleSubmit,
  onChangeInput: handleChange 
}">
  <copilot-chat></copilot-chat>
</div>
```

```typescript
export class ChatComponent {
  handleSubmit = (value: string) => {
    console.log('Message submitted:', value);
  };
  
  handleChange = (value: string) => {
    console.log('Input changed:', value);
  };
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

Example Angular server (from `apps/angular/demo-server`):

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
import { AnyAGUIAgent } from "@ag-ui/your-desired-agent-framework";

const runtime = new CopilotRuntime({
  agents: { default: new AnyAGUIAgent() },
});

// Create a main app with CORS enabled
const app = new Hono();

// Enable CORS for local dev (Angular demo at http://localhost:4200)
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

// Create the CopilotKit endpoint
const copilotApp = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

// Mount the CopilotKit app
app.route("/", copilotApp);

const port = Number(process.env.PORT || 3001);
serve({ fetch: app.fetch, port });
console.log(
  `CopilotKit runtime listening at http://localhost:${port}/api/copilotkit`
);
```

## CopilotKit Angular APIs (Most Used)

### Components

- **`CopilotChatComponent`**: Full chat UI
  - Inputs: `agentId?: string`

### Directives

- **`CopilotKitConfigDirective`** (`[copilotkitConfig]`): Set `runtimeUrl`, `headers`, `properties`, and/or `agents` declaratively
- **`CopilotKitAgentDirective`** (`[copilotkitAgent]`): Observe agent state; defaults to the `default` agent if no `agentId` is provided

### Providers

- **`provideCopilotKit(...)`**: Set runtime URL, headers, properties, agents, tools, human-in-the-loop handlers
- **`provideCopilotChatConfiguration(...)`**: Set UI labels and behavior for chat input/view

## Headless Usage: Building Custom Chat UIs

For advanced use cases where you need full control over the chat UI, you can use the `watchAgent` utility directly to build a custom chat component.

### Using `watchAgent` for Custom Components

The `watchAgent` function provides reactive signals for agent state, making it easy to build custom chat interfaces:

```typescript
import { Component, effect } from "@angular/core";
import { watchAgent } from "@copilotkitnext/angular";

@Component({
  selector: "my-custom-chat",
  template: `
    <div class="custom-chat">
      <div *ngFor="let msg of messages()" class="message">
        {{ msg.content }}
      </div>
      <input
        [disabled]="isRunning()"
        (keyup.enter)="sendMessage($event)"
      />
    </div>
  `,
})
export class MyCustomChatComponent {
  protected agent!: ReturnType<typeof watchAgent>["agent"];
  protected messages!: ReturnType<typeof watchAgent>["messages"];
  protected isRunning!: ReturnType<typeof watchAgent>["isRunning"];

  constructor() {
    const w = watchAgent({ agentId: "custom" });
    this.agent = w.agent;
    this.messages = w.messages;
    this.isRunning = w.isRunning;

    // React to agent changes
    effect(() => {
      const currentAgent = this.agent();
      if (currentAgent) {
        console.log("Agent ready:", currentAgent.id);
      }
    });
  }

  async sendMessage(event: Event) {
    const input = event.target as HTMLInputElement;
    const content = input.value.trim();
    if (!content || !this.agent()) return;

    // Add user message and run agent
    this.agent()!.addMessage({ role: "user", content });
    input.value = "";
    await this.agent()!.runAgent();
  }
}
```

### Switching Agents at Runtime

Use `watchAgentWith` when you need to switch agents dynamically outside of the constructor:

```typescript
import { Component, Injector } from "@angular/core";
import { watchAgent, watchAgentWith } from "@copilotkitnext/angular";

@Component({
  selector: "agent-switcher",
  template: `
    <button (click)="switchToAgent('sales')">Sales Agent</button>
    <button (click)="switchToAgent('support')">Support Agent</button>
    <div>Current Agent: {{ agent()?.id || 'None' }}</div>
  `,
})
export class AgentSwitcherComponent {
  protected agent!: ReturnType<typeof watchAgent>["agent"];
  protected messages!: ReturnType<typeof watchAgent>["messages"];
  protected isRunning!: ReturnType<typeof watchAgent>["isRunning"];
  private watcher?: ReturnType<typeof watchAgent>;

  constructor(private injector: Injector) {
    // Initialize with default agent
    this.switchToAgent("default");
  }

  switchToAgent(agentId: string) {
    // Clean up previous watcher
    this.watcher?.unsubscribe();

    // Create new watcher with the ergonomic helper
    const w = watchAgentWith(this.injector, { agentId });

    // Update component signals
    this.agent = w.agent;
    this.messages = w.messages;
    this.isRunning = w.isRunning;
    this.watcher = w;
  }
}
```

### Rendering Tool Calls (Headless)

To render tool calls in a headless UI, register renderers in your providers and drop the lightweight view in your template.

1) Register tool renderers (e.g., a wildcard that renders any tool):

```ts
import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { provideCopilotKit } from '@copilotkitnext/angular';

// Simple demo renderer (Component or TemplateRef accepted)
@Component({
  standalone: true,
  template: `
    <div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;margin:8px 0;">
      <div style="font-weight:600;margin-bottom:6px;">Tool: {{ name }}</div>
      <pre style="margin:0;white-space:pre-wrap;">{{ args | json }}</pre>
      <div *ngIf="result" style="margin-top:6px;">Result: {{ result }}</div>
    </div>
  `,
})
export class WildcardToolRenderComponent {
  @Input() name!: string;
  @Input() args: any;
  @Input() status: any;
  @Input() result?: string;
}

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(BrowserModule),
    ...provideCopilotKit({
      renderToolCalls: [
        { name: '*', render: WildcardToolRenderComponent },
      ],
    }),
  ],
};
```

2) Render tool calls under assistant messages using the headless view component:

```ts
import { Component } from '@angular/core';
import { watchAgent, CopilotChatToolCallsViewComponent } from '@copilotkitnext/angular';

@Component({
  standalone: true,
  imports: [CopilotChatToolCallsViewComponent],
  template: `
    <div *ngFor="let m of messages()">
      <div>{{ m.role }}: {{ m.content }}</div>
      <ng-container *ngIf="m.role === 'assistant'">
        <copilot-chat-tool-calls-view
          [message]="m"
          [messages]="messages()"
          [isLoading]="isRunning()"
        />
      </ng-container>
    </div>
  `,
})
export class HeadlessWithToolsComponent {
  agent = watchAgent().agent;
  messages = watchAgent().messages;
  isRunning = watchAgent().isRunning;
}
```

Notes:
- If you prefer full manual control, you can render a specific tool call with `CopilotKitToolRenderComponent` and pass `toolName`, `args`, `status`, and `result` yourself.
- You can also register tool renders declaratively via the `CopilotKitFrontendToolDirective` by using `[copilotkitFrontendTool]` in templates.

### Key Benefits of Headless Usage

- **Full control**: Build any UI you need without constraints
- **Reactive signals**: Automatically update UI when agent state changes
- **Type safety**: Full TypeScript support with AG-UI types
- **Memory efficient**: Automatic cleanup via Angular's DestroyRef
- **Framework agnostic**: Works with any AG-UI compatible agent

## End-to-End: Running the Demo

From the repo root:

1. **Install deps**: `pnpm install`
2. **Start both demo server and Angular demo app**: pnpm build && pnpm demo:angular`
   - Frontend: runs on http://localhost:4200
   - Backend: runs on http://localhost:3001/api/copilotkit
3. **Prerequisite**: Set `OPENAI_API_KEY` in `apps/angular/demo-server/.env` if using the OpenAI demo agent

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
