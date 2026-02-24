# CopilotKit for Angular

`@copilotkitnext/angular` provides Angular-native providers, components, directives, and registration APIs for CopilotKit agents and chat UIs.

## Requirements

- Angular `^19.0.0`
- Node.js `18+`
- `@angular/core`, `@angular/common`, `@angular/cdk`, `rxjs` installed in your app

## Installation

```bash
# pnpm
pnpm add @copilotkitnext/angular

# npm
npm install @copilotkitnext/angular

# yarn
yarn add @copilotkitnext/angular
```

### Peer Dependencies

Install these in the consuming app:

- `@angular/core` `^19.0.0`
- `@angular/common` `^19.0.0`
- `@angular/cdk` `^19.0.0`
- `rxjs` `^7.8.0`

### Styles

Include package styles so built-in chat UI components render correctly.

Option 1 (`angular.json`):

```json
"styles": [
  "node_modules/@copilotkitnext/angular/dist/styles.css",
  "src/styles.css"
]
```

Option 2 (global stylesheet):

```css
@import "@copilotkitnext/angular/styles.css";
```

## Quick Start

Configure CopilotKit in `app.config.ts`:

```ts
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
    }),
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask me anything...",
      chatDisclaimerText: "AI can make mistakes. Verify important info.",
    }),
  ],
};
```

Render chat UI:

```html
<copilot-chat></copilot-chat>
```

## Main APIs

### `provideCopilotKit(config)`

`provideCopilotKit` accepts:

- `runtimeUrl?: string`
- `headers?: Record<string, string>`
- `properties?: Record<string, unknown>`
- `agents?: Record<string, AbstractAgent>`
- `tools?: ClientTool[]`
- `renderToolCalls?: RenderToolCallConfig[]`
- `frontendTools?: FrontendToolConfig[]`
- `humanInTheLoop?: HumanInTheLoopConfig[]`

Notes:

- If a `tools[]` entry contains both `renderer` and `parameters`, the renderer is also registered for tool-call UI.
- Frontend tools and HITL tools from config are registered on startup.

### `CopilotChat`

`CopilotChat` is the batteries-included chat component.

Inputs:

- `agentId?: string`
- `threadId?: string`
- `inputComponent?: Type<any>`

Examples:

```html
<copilot-chat></copilot-chat>
<copilot-chat [agentId]="'openai'"></copilot-chat>
<copilot-chat [threadId]="'thread-1'"></copilot-chat>
```

### Custom Input (`injectChatState`)

Custom input components can call `injectChatState()` and use:

- `changeInput(value: string)`
- `submitInput(value: string)`

```ts
import { Component, Input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { injectChatState } from "@copilotkitnext/angular";

@Component({
  selector: "my-custom-input",
  standalone: true,
  imports: [FormsModule],
  template: `
    <form (ngSubmit)="submit()">
      <input
        [(ngModel)]="value"
        name="message"
        [disabled]="inProgress"
        (ngModelChange)="chatState.changeInput($event)"
      />
      <button type="submit" [disabled]="inProgress || !value.trim()">
        Send
      </button>
    </form>
  `,
})
export class MyCustomInputComponent {
  @Input() inProgress = false;
  value = "";
  readonly chatState = injectChatState();

  submit(): void {
    const content = this.value.trim();
    if (!content) return;
    this.chatState.submitInput(content);
    this.value = "";
  }
}
```

Use it:

```html
<copilot-chat [inputComponent]="customInput"></copilot-chat>
```

### Headless Agent State (`injectAgentStore`)

Use `injectAgentStore(agentIdOrSignal)` for custom layouts.

```ts
import { Component, computed, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  CopilotKit,
  RenderToolCalls,
  injectAgentStore,
} from "@copilotkitnext/angular";

@Component({
  selector: "headless-chat",
  standalone: true,
  imports: [CommonModule, FormsModule, RenderToolCalls],
  template: `
    <div *ngFor="let m of messages()">
      <div>{{ m.role }}: {{ m.content }}</div>
      <copilot-render-tool-calls
        *ngIf="m.role === 'assistant'"
        [message]="m"
        [messages]="messages()"
        [isLoading]="isRunning()"
      />
    </div>

    <form (ngSubmit)="send()">
      <input name="message" [(ngModel)]="inputValue" [disabled]="isRunning()" />
      <button type="submit" [disabled]="isRunning() || !inputValue.trim()">
        Send
      </button>
    </form>
  `,
})
export class HeadlessChatComponent {
  readonly store = injectAgentStore("openai");
  readonly agent = computed(() => this.store()?.agent);
  readonly messages = computed(() => this.store()?.messages() ?? []);
  readonly isRunning = computed(() => !!this.store()?.isRunning());
  readonly copilotkit = inject(CopilotKit);

  inputValue = "";

  async send(): Promise<void> {
    const content = this.inputValue.trim();
    const agent = this.agent();
    if (!agent || !content || this.isRunning()) return;

    agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
    this.inputValue = "";
    await this.copilotkit.core.runAgent({ agent });
  }
}
```

## Tool Rendering and Tool Registration

### Render Tool Calls (`RenderToolCalls` / `copilot-render-tool-calls`)

`RenderToolCalls` resolves the renderer in this order:

1. `renderToolCalls` match by tool name (and `agentId` when set)
2. `frontendTools` match by tool name
3. `humanInTheLoop` match by tool name
4. wildcard renderer (`name: "*"`)

Register renderers globally:

```ts
import { Component, input } from "@angular/core";
import { z } from "zod";
import {
  AngularToolCall,
  ToolRenderer,
  provideCopilotKit,
} from "@copilotkitnext/angular";

@Component({
  selector: "weather-tool-renderer",
  standalone: true,
  template: `<pre>{{ toolCall().args | json }}</pre>`,
})
export class WeatherToolRenderer implements ToolRenderer<{ city: string }> {
  readonly toolCall = input.required<AngularToolCall<{ city: string }>>();
}

provideCopilotKit({
  runtimeUrl: "http://localhost:3001/api/copilotkit",
  renderToolCalls: [
    {
      name: "weather",
      args: z.object({ city: z.string() }),
      component: WeatherToolRenderer,
    },
  ],
});
```

For dynamic registration in an injection context, use `registerRenderToolCall(...)`.

### Frontend Tools (`registerFrontendTool`)

Call from an injection context (component/directive/service constructor, etc.).

```ts
import { Component } from "@angular/core";
import { registerFrontendTool } from "@copilotkitnext/angular";
import { z } from "zod";

@Component({
  selector: "tool-registration",
  standalone: true,
  template: "",
})
export class ToolRegistrationComponent {
  constructor() {
    registerFrontendTool({
      name: "formatDate",
      description: "Formats an ISO date string",
      parameters: z.object({ iso: z.string() }),
      handler: async ({ iso }) => new Date(iso).toISOString(),
    });
  }
}
```

### Human In The Loop (`registerHumanInTheLoop`)

```ts
import { Component, input } from "@angular/core";
import {
  HumanInTheLoopToolCall,
  HumanInTheLoopToolRenderer,
  registerHumanInTheLoop,
} from "@copilotkitnext/angular";
import { z } from "zod";

@Component({
  selector: "require-approval",
  standalone: true,
  template: `
    <button (click)="approve()">Approve</button>
    <button (click)="deny()">Deny</button>
  `,
})
export class RequireApprovalComponent implements HumanInTheLoopToolRenderer<{
  action: string;
  reason: string;
}> {
  readonly toolCall =
    input.required<
      HumanInTheLoopToolCall<{ action: string; reason: string }>
    >();

  approve(): void {
    this.toolCall().respond({ approved: true });
  }

  deny(): void {
    this.toolCall().respond({ approved: false });
  }
}

registerHumanInTheLoop({
  name: "requireApproval",
  description: "Requires user approval",
  parameters: z.object({ action: z.string(), reason: z.string() }),
  component: RequireApprovalComponent,
});
```

## Agent Context

### `connectAgentContext`

Connect static or signal-driven context to `CopilotKit.core`:

```ts
import { signal } from "@angular/core";
import { connectAgentContext } from "@copilotkitnext/angular";

connectAgentContext(
  signal({
    description: "Selected customer",
    value: "customer-123",
  }),
);
```

`connectAgentContext(...)` must run in an injection context, or you must pass `{ injector }`.

### `copilotkitAgentContext` Directive

Object form:

```html
<div
  [copilotkitAgentContext]="{ description: 'Selected customer', value: selectedCustomer }"
></div>
```

Split inputs form:

```html
<div
  copilotkitAgentContext
  [description]="'Selected customer'"
  [value]="selectedCustomer"
></div>
```

## UI Customization (`CopilotChatView`)

`CopilotChatView` supports component/template overrides for:

- `messageView`
- `scrollView`
- `scrollToBottomButton`
- `input`
- `inputContainer`
- `feather`
- `disclaimer`

You can also supply named templates for deep sub-slots such as:

- `#sendButton`, `#toolbar`, `#textArea`, `#audioRecorder`
- `#assistantMessageMarkdownRenderer`
- `#thumbsUpButton`, `#thumbsDownButton`, `#readAloudButton`, `#regenerateButton`

Important outputs on `CopilotChatView`:

- `assistantMessageThumbsUp`
- `assistantMessageThumbsDown`
- `assistantMessageReadAloud`
- `assistantMessageRegenerate`
- `userMessageCopy`
- `userMessageEdit`

## Common Exports

- Providers/config: `provideCopilotKit`, `provideCopilotChatLabels`
- Core service: `CopilotKit`
- Agent/chat state: `injectAgentStore`, `injectChatState`, `ChatState`
- Tool APIs: `registerRenderToolCall`, `registerFrontendTool`, `registerHumanInTheLoop`, `RenderToolCalls`
- Context APIs: `connectAgentContext`, `CopilotKitAgentContext`
- Chat components: `CopilotChat`, `CopilotChatView`, `CopilotChatInput`, `CopilotChatMessageView`, `CopilotChatToolCallsView`
- Slots: `CopilotSlot`
- Utility directives: `StickToBottom`, `CopilotTooltip`

## Monorepo Commands

From repo root:

```bash
pnpm install
pnpm demo:next:angular
pnpm storybook:angular
```

## Package Verification

From repo root:

```bash
pnpm nx run @copilotkitnext/angular:build --excludeTaskDependencies
pnpm nx run @copilotkitnext/angular:lint --excludeTaskDependencies
pnpm nx run @copilotkitnext/angular:test --excludeTaskDependencies
pnpm nx run @copilotkitnext/angular:check-types --excludeTaskDependencies
```
