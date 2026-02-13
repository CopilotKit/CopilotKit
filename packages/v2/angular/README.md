# CopilotKit for Angular

This package provides Angular-native components, directives, and providers for building Copilot chat UIs powered by CopilotKit runtime and AG-UI agents.

## Requirements

- Angular 19
- Node 18+
- pnpm 9+

## Installation

Install the package in your Angular app:

```bash
# pnpm
pnpm add @copilotkitnext/angular

# npm
npm install @copilotkitnext/angular

# yarn
yarn add @copilotkitnext/angular
```

### Peer Dependencies

Ensure these are installed in your app:

- `@angular/core` `^19.0.0`
- `@angular/common` `^19.0.0`
- `@angular/cdk` `^19.0.0`
- `rxjs` `^7.8.0`
- `tslib` `^2.6.0`

### Styles

Include package styles so chat components render correctly.

**Option 1:** in `angular.json`

```json
"styles": [
  "node_modules/@copilotkitnext/angular/dist/styles.css",
  "src/styles.css"
]
```

**Option 2:** in a global stylesheet

```css
@import "@copilotkitnext/angular/styles.css";
```

## Quick Start

Configure providers in `app.config.ts`:

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

Render the chat:

```html
<copilot-chat></copilot-chat>
```

## Core Usage

### `CopilotChat`

`CopilotChat` is the full chat UI.

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

### Custom Input Components (`injectChatState`)

To replace the default input, pass a custom standalone component to `[inputComponent]` and call `submitInput` / `changeInput` via `injectChatState()`.

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
      <button type="submit" [disabled]="inProgress || !value.trim()">Send</button>
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

```ts
import { Component } from "@angular/core";
import { CopilotChat } from "@copilotkitnext/angular";
import { MyCustomInputComponent } from "./my-custom-input.component";

@Component({
  selector: "app-chat",
  standalone: true,
  imports: [CopilotChat],
  template: `<copilot-chat [inputComponent]="customInput"></copilot-chat>`,
})
export class ChatComponent {
  customInput = MyCustomInputComponent;
}
```

### Headless Chat (`injectAgentStore`)

For custom layouts, use `injectAgentStore(...)` and run the agent through `CopilotKit.core`.

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
      <button type="submit" [disabled]="isRunning() || !inputValue.trim()">Send</button>
    </form>
  `,
})
export class HeadlessChatComponent {
  readonly agentStore = injectAgentStore("openai");
  readonly agent = computed(() => this.agentStore()?.agent);
  readonly messages = computed(() => this.agentStore()?.messages() ?? []);
  readonly isRunning = computed(() => !!this.agentStore()?.isRunning());
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

## Tool Calls and Human-In-The-Loop

### Render Tool Calls

Register tool renderers globally with `provideCopilotKit({ renderToolCalls: [...] })`.

```ts
import { Component, input } from "@angular/core";
import {
  AngularToolCall,
  ToolRenderer,
  provideCopilotKit,
} from "@copilotkitnext/angular";

@Component({
  selector: "wildcard-tool-render",
  standalone: true,
  template: `
    <div>
      <pre>{{ toolCall().args | json }}</pre>
      <div>status: {{ toolCall().status }}</div>
      <div>result: {{ toolCall().result }}</div>
    </div>
  `,
})
export class WildcardToolRenderComponent implements ToolRenderer {
  readonly toolCall = input.required<AngularToolCall<any>>();
}

// in providers:
provideCopilotKit({
  runtimeUrl: "http://localhost:3001/api/copilotkit",
  renderToolCalls: [{ name: "*", component: WildcardToolRenderComponent } as any],
});
```

Note: wildcard entries typically use `as any` because `RenderToolCallConfig` expects an explicit `args` zod schema.

### Frontend Tools

Register frontend tools in an injection context (component/directive/service):

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
      description: "Formats a date string",
      parameters: z.object({ iso: z.string() }),
      handler: async ({ iso }) => new Date(iso).toISOString(),
    });
  }
}
```

### Human-In-The-Loop

Define HITL handlers with `registerHumanInTheLoop(...)`:

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
export class RequireApprovalComponent implements HumanInTheLoopToolRenderer {
  readonly toolCall = input.required<
    HumanInTheLoopToolCall<{ action: string; reason: string }>
  >();

  approve(): void {
    this.toolCall().respond({ approved: true });
  }

  deny(): void {
    this.toolCall().respond({ approved: false });
  }
}

// in constructor of any injectable context:
registerHumanInTheLoop({
  name: "requireApproval",
  description: "Requires user approval",
  parameters: z.object({ action: z.string(), reason: z.string() }),
  component: RequireApprovalComponent,
});
```

## Agent Context

### Signal/API style

`connectAgentContext(...)` links context to the current injection scope:

```ts
import { signal } from "@angular/core";
import { connectAgentContext } from "@copilotkitnext/angular";

connectAgentContext(
  signal({
    description: "voice-mode",
    value: "active",
  }),
);
```

### Directive style

Use `[copilotkitAgentContext]` in templates:

```html
<div
  [copilotkitAgentContext]="{ description: 'Selected customer', value: selectedCustomer }"
></div>
```

Or with separate inputs:

```html
<div
  copilotkitAgentContext
  [description]="'Selected customer'"
  [value]="selectedCustomer"
></div>
```

## Most Used Exports

- Providers/config: `provideCopilotKit`, `provideCopilotChatLabels`
- Core service: `CopilotKit`
- State hooks: `injectAgentStore`, `injectChatState`
- Context APIs: `connectAgentContext`, `CopilotKitAgentContext`
- Tool APIs: `registerRenderToolCall`, `registerFrontendTool`, `registerHumanInTheLoop`
- Components: `CopilotChat`, `CopilotChatView`, `CopilotChatInput`, `CopilotChatMessageView`, `RenderToolCalls`
- Slots: `CopilotSlot`

## Running in This Monorepo

From repo root:

```bash
pnpm install
pnpm build
pnpm demo:next:angular
```

- Frontend: `http://localhost:4200`
- Runtime endpoint: `http://localhost:3001/api/copilotkit`

Storybook:

```bash
pnpm storybook:angular
```

## Package Verification

```bash
pnpm -C packages/v2/angular build
pnpm -C packages/v2/angular lint
pnpm -C packages/v2/angular test
pnpm -C packages/v2/angular check-types
```
