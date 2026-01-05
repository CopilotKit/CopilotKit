# CopilotKit Angular Design

Status: **DRAFT**
Version: **v0.01**
Author: **Mike Ryan**
Reviewer: **Markus Ecker**

# Goals

CopilotKit has a well-defined React library for building on top of the AG-UI protocol. It provides helpers for tool calls and building chat interfaces. The goal of this document is to design an Angular library with feature parity with the React implementation. It should adhere to CopilotKit’s existing architectural philosophy and design patterns, while being idiomatic Angular.

# Providing CopilotKit

## API Design

Developers supply configuration

```ts
export interface CopilotKitConfig {
  runtimeUrl?: string;
  headers?: Record<string, string>;
  properties?: Record<string, unknown>;
  agents?: Record<string, AbstractAgent>;
  tools?: ClientTool[];
  renderToolCalls?: ToolCallRendererConfig[];
}

const COPILOT_KIT_CONFIG = new InjectionToken<CopilotKitConfig>(
  "COPILOT_KIT_CONFIG"
);

export function injectCopilotKitConfig(): CopilotKitConfig {
  return inject(COPILOT_KIT_CONFIG);
}

export function provideCopilotKit(config: CopilotKitConfig): Provider {
  return { provide: COPILOT_KIT_CONFIG, useValue: config };
}
```

## Example

```ts
const appConfig: AppConfig = {
  providers: [
    provideCopilotKit({
      runtimeUrl: "",
      headers: {},
      properties: {},
      agents: {},
      tools: [],
      renderToolCalls: [],
    }),
  ],
};
```

# CopilotKit

Service that wraps CopilotKitCore. We **do not** want to extend CopilotKitCore because:

1. This service will need to convert Angular tools into native CopilotKitCore tools
2. We will want to provide facades for agents

**Name:** `CopilotKit` ← adheres to the [Angular Style Guide](https://angular.dev/style-guide#dependency-injection)

```ts
import { AbstractAgent } from "@ag-ui/client";
import { FrontendTool } from "@copilotkitnext/core";
import {
  Injector,
  Signal,
  WritableSignal,
  runInInjectionContext,
  signal,
} from "@angular/core";
import {
  ClientTool,
  ToolCallRendererConfig,
  injectCopilotKitConfig,
} from "@copilotkitnext/angular";

@Injectable({ providedIn: "root" })
export class CopilotKit {
  readonly #config = injectCopilotKitConfig();

  /**
   * Public API for accessing the instance of CopilotKitCore
   */
  readonly core = new CopilotKitCore({
    runtimeUrl: this.#config.runtimeUrl,
    headers: this.#config.headers,
    properties: this.#config.properties,
    agents: this.#config.agents,
    tools: Object.fromEntries(
      (this.#config.tools ?? []).map<readonly [string, FrontendTool<any>]>(
        (tool) => {
          const { renderer, ...frontendCandidate } = tool;
          return [tool.name, frontendCandidate];
        }
      )
    ),
  });

  readonly #renderToolCalls: WritableSignal<ToolCallRendererConfig[]> = signal(
    []
  );
  readonly renderToolCalls: Signal<ToolCallRendererConfig[]> =
    this.#renderToolCalls.asReadonly();

  constructor() {
    this.#config.renderToolCalls?.forEach((renderConfig) => {
      this.addRenderToolCall(renderConfig);
    });

    this.#config.tools?.forEach((tool) => {
      if (tool.renderer && tool.parameters) {
        this.addRenderToolCall({
          name: tool.name,
          args: tool.parameters,
          component: tool.renderer,
          agentId: tool.agentId,
        });
      }
    });
  }

  /**
   * Adds a client tool in Angular's injection context
   */
  addTool<Args extends Record<string, unknown>>(
    clientToolWithInjector: ClientTool<Args> & { injector: Injector }
  ): void {
    const { injector, ...clientTool } = clientToolWithInjector;

    const { renderer, ...frontendCandidate } = clientTool;

    const tool: FrontendTool<Args> = {
      ...frontendCandidate,
      handler: clientTool.handler
        ? (args) =>
            runInInjectionContext(injector, () => clientTool.handler?.(args))
        : undefined,
    };

    this.core.addTool(tool);

    if (renderer && clientTool.parameters) {
      this.addRenderToolCall({
        name: clientTool.name,
        args: clientTool.parameters,
        component: renderer,
        agentId: clientTool.agentId,
      });
    }
  }

  addRenderToolCall(renderConfig: ToolCallRendererConfig): void {
    this.#renderToolCalls.update((current) => [
      ...current.filter(
        (existing) =>
          existing.name !== renderConfig.name ||
          existing.agentId !== renderConfig.agentId
      ),
      renderConfig,
    ]);
  }

  removeRenderToolCall(name: string, agentId?: string): void {
    this.#renderToolCalls.update((current) =>
      current.filter(
        (renderConfig) =>
          renderConfig.name !== name || renderConfig.agentId !== agentId
      )
    );
  }

  /**
   * Removes a tool by name, equivalent to CopilotKit#core.removeTool(...)
   */
  removeTool(toolName: string, agentId?: string): void {
    this.core.removeTool(toolName);
    this.removeRenderToolCall(toolName, agentId);
  }

  /**
   * Passthrough for CopilotKitCore#getAgent so consumers do not need to reach
   * into the core instance.
   */
  getAgent(agentId: string): AbstractAgent | undefined {
    return this.core.getAgent(agentId);
  }

  /**
   * Update runtime-facing configuration after bootstrap.
   */
  updateRuntime(options: {
    runtimeUrl?: string;
    headers?: Record<string, string>;
    properties?: Record<string, unknown>;
    agents?: Record<string, AbstractAgent>;
  }): void {
    if (options.runtimeUrl !== undefined) {
      this.core.setRuntimeUrl(options.runtimeUrl);
    }
    if (options.headers !== undefined) {
      this.core.setHeaders(options.headers);
    }
    if (options.properties !== undefined) {
      this.core.setProperties(options.properties);
    }
    if (options.agents !== undefined) {
      this.core.setAgents(options.agents);
    }
  }
}
```

## CopilotkitAgent

## API

Angular-ified facade around `CopilotKitCore#getAgent`, could maybe subclass `AbstractAgent`?

```ts
import { DestroyRef, Signal, inject, signal } from "@angular/core";
import { AbstractAgent } from "@ag-ui/client";
import { CopilotKit } from "@copilotkitnext/angular";

@Injectable() // <- not provided at root, this is just a facade
export class CopilotkitAgentFactory {
  readonly #copilotkit = inject(CopilotKit);

  /**
   * Wraps an AbstractAgent in an Angular signal
   */
  createAgentSignal(
    agentId: string,
    destroyRef: DestroyRef
  ): Signal<AbstractAgent | undefined> {
    const agent = signal<AbstractAgent | undefined>(
      this.#copilotkit.getAgent(agentId)
    );

    const attachAgentSubscription = (targetAgent: AbstractAgent) => {
      const subscription = targetAgent.subscribe({
        onMessagesChanged() {
          agent.set(targetAgent);
        },
        onStateChanged() {
          agent.set(targetAgent);
        },
      });

      destroyRef.onDestroy(() => subscription.unsubscribe());
    };

    const currentAgent = agent();

    if (currentAgent) {
      attachAgentSubscription(currentAgent);
    } else {
      const unsubscribe = this.#copilotkit.core.subscribe({
        onRuntimeLoaded: () => {
          const loadedAgent = this.#copilotkit.getAgent(agentId);
          if (loadedAgent) {
            agent.set(loadedAgent);
            attachAgentSubscription(loadedAgent);
            unsubscribe();
          }
        },
      });

      destroyRef.onDestroy(() => unsubscribe());
    }

    return agent;
  }
}

// Facade factory
export function injectAgent(agentId: string) {
  const agentFactory = inject(CopilotkitAgentFactory);
  const destroyRef = inject(DestroyRef);

  return agentFactory.createAgentSignal(agentId, destroyRef);
}
```

## Example

Developers can inject an agent anywhere:

```ts
@Component({ ... })
export class SomeComponent {
  readonly #agent = injectAgent('some id');
}
```

# ClientTool

## API

Angular component authors implement this interface:

```ts
export type ClientToolCall<Args extends object = Record<string, unknown>> =
  | {
      args: Partial<Args>;
      // Convert ToolCallStatus into a string literal for easy consumption in
      // Angular templates
      status: "InProgress";
      result: undefined;
    }
  | {
      args: Args;
      status: "Executing";
      result: undefined;
    }
  | {
      args: Args;
      status: "Complete";
      result: string;
    };

interface ClientToolRenderer<
  Args extends Record<string, unknown> = Record<string, unknown>,
> {
  toolCall: Signal<ClientToolCall<Args>>;
}
```

Developers will need to configure a `ClientTool` with this interface:

```ts
import { DestroyRef, Injector, Signal, Type, inject } from "@angular/core";
import { CopilotKit } from "@copilotkitnext/angular";
import { FrontendTool } from "@copilotkitnext/core";
import { z } from "zod";

type ClientTool<Args extends Record<string, unknown>> = FrontendTool<Args> & {
  renderer?: Type<ClientToolRenderer>;
};

interface ToolCallRendererConfig<
  Args extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string;
  args: z.ZodType<Args>;
  component: Type<ClientToolRenderer<Args>>;
  agentId?: string;
}
```

`CopilotKit#addTool` (defined above) binds the handler inside the supplied `Injector` with `runInInjectionContext` so that `inject()` works when the tool executes. Helper that adds a client tool in an injection context. This is the primary API developers will consume:

```ts
function registerClientTool<Args extends Record<string, unknown>>(
  clientTool: ClientTool<Args>
) {
  const injector = inject(Injector);
  const destroyRef = inject(DestroyRef);
  const copilotKit = inject(CopilotKit);

  copilotKit.addTool({
    ...clientTool,
    injector,
  });

  destroyRef.onDestroy(() => {
    copilotKit.removeTool(clientTool.name, clientTool.agentId);
  });
}
```

## Example

The developer creates their component:

```ts
import { Component, input } from "@angular/core";
import { ToolCallStatus } from "@copilotkitnext/core";
import { ClientToolCall, ToolCallRenderer } from "@copilotkitnext/angular";

interface WeatherToolArgs {
  location: string;
}

@Component({
  selector: "app-weather-tool-renderer",
  template: `
    @if (toolCall().status === ToolCallStatus.InProgress) {
      Preparing to get the weather...
    } @else if (toolCall().status === ToolCallStatus.Executing) {
      Fetching the weather...
      {{ toolCall().args | json }}
    } @else {
      Got the weather: {{ toolCall().result }};
    }
  `,
})
export class WeatherToolRenderer implements ToolCallRenderer {
  readonly toolCall = input.required<ClientToolCall<WeatherToolArgs>>();
}
```

And then they register it in another component. When registered, the tool’s lifecycle is bound to the lifecycle of the component. Tools will need to be run in component constructors, or some other valid injection context.

```ts
import { Component, inject } from "@angular/core";
import { z } from "zod";

@Component({
  selector: 'app-page',
  template: '...',
})
export class Page {
  constructor() {
    registerClientTool({
      name: 'get_weather',
      description: 'Fetches the latest weather forecast',
      parameters: z.object(...),
      renderer: WeatherToolRenderer,
      handler: (args) => { // <- let's ensure this is strongly typed
        const weather = inject(Weather);

        return weather.getForecast(args);
      }
    })
  }
}
```

# Rendering Tool Calls

## API

Angular developers will need an outlet to render tool calls. The outlet accepts an assistant message and renders the associated tool calls:

```ts
import { NgComponentOutlet } from "@angular/common";
import { Component, inject, input } from "@angular/core";
import { AssistantMessage, ToolCall } from "@ag-ui/client";
import {
  ClientToolCall,
  CopilotKit,
  ToolCallRendererConfig,
} from "@copilotkitnext/angular";
import { ToolCallStatus } from "@copilotkitnext/core";

@Component({
  selector: "copilot-render-tool-calls",
  standalone: true,
  imports: [NgComponentOutlet],
  template: `
    @for (toolCall of message().toolCalls ?? []; track toolCall.id) {
      @let renderConfig = pickRenderer(toolCall.function.name);
      @if (renderConfig) {
        <ng-container
          *ngComponentOutlet="
            renderConfig.component;
            inputs: { toolCall: buildToolCall(toolCall, renderConfig) }
          "
        />
      }
    }
  `,
})
export class RenderToolCalls {
  private readonly copilotKit = inject(CopilotKit);
  readonly message = input.required<AssistantMessage>();

  pickRenderer(name: string): ToolCallRendererConfig | undefined {
    const messageAgentId = this.message().agentId;
    const renderers = this.copilotKit.renderToolCalls();

    return (
      renderers.find(
        (candidate) =>
          candidate.name === name &&
          (candidate.agentId === undefined ||
            candidate.agentId === messageAgentId)
      ) ?? renderers.find((candidate) => candidate.name === "*")
    );
  }

  buildToolCall(
    toolCall: ToolCall,
    renderConfig: ToolCallRendererConfig
  ): ClientToolCall {
    const args = JSON.parse(toolCall.function.arguments ?? "{}");

    // TODO: look up the matching tool message to emit Executing/Complete states.
    return {
      args,
      status: ToolCallStatus.InProgress,
      result: undefined,
    };
  }
}
```

## Example

```ts
@Component({
  selector: "app-custom-assistant-message",
  imports: [RenderToolCalls, Markdown],
  template: `
    <copilot-render-tool-calls [message]="message()" />
    <copilot-markdown [markdown]="message().content" />
  `,
})
export class CustomAssistantMessage {
  readonly message = input.required<AssistantMessage>();
}
```
