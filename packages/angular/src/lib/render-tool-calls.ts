import { NgComponentOutlet } from "@angular/common";
import {
  Component,
  Injector,
  computed,
  inject,
  input,
  ChangeDetectionStrategy,
} from "@angular/core";
import type {
  AssistantMessage,
  Message,
  ToolCall,
  ToolMessage,
} from "@ag-ui/client";
import type { AbstractAgent } from "@ag-ui/client";
import { contentToText } from "@ag-ui/client";
import { CopilotKit } from "./copilotkit";
import type {
  FrontendToolConfig,
  HumanInTheLoopToolCall,
  HumanInTheLoopConfig,
  AngularToolCall,
  RenderToolCallConfig,
} from "./tools";
import { partialJSONParse } from "@copilotkit/shared";
import { HumanInTheLoop } from "./human-in-the-loop";
import { CopilotDefaultToolRenderer } from "./components/tools/default-tool-renderer";
import {
  TOOL_CALL_RENDER_CONTEXT,
  type ToolCallRenderContext,
} from "./components/tools/tool-call-render-context";

type RendererToolCallHandler = {
  type: "renderer";
  config: RenderToolCallConfig;
};
type ClientToolCallHandler = {
  type: "clientTool";
  config: FrontendToolConfig;
};
type HumanInTheLoopToolCallHandler = {
  type: "humanInTheLoopTool";
  config: HumanInTheLoopConfig;
};
type BuiltInToolCallHandler = {
  type: "builtIn";
  config: { component: typeof CopilotDefaultToolRenderer };
};

export type ToolCallHandler =
  | RendererToolCallHandler
  | ClientToolCallHandler
  | HumanInTheLoopToolCallHandler
  | BuiltInToolCallHandler;

/** Parse tool-call arguments without allowing malformed payloads to escape. */
export function parseToolCallArguments(
  rawArguments: string,
  allowPartial = false,
): Record<string, unknown> {
  try {
    const parsed = allowPartial
      ? partialJSONParse(rawArguments)
      : JSON.parse(rawArguments);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }

    return { _value: parsed };
  } catch {
    return { _raw: rawArguments };
  }
}

interface PickToolCallHandlerOptions {
  name: string;
  agentId?: string;
  application: readonly RenderToolCallConfig[];
  frontend: readonly FrontendToolConfig[];
  humanInTheLoop: readonly HumanInTheLoopConfig[];
  builtInFallback: boolean;
}

function namedForAgent<T extends { name: string; agentId?: string }>(
  entries: readonly T[],
  name: string,
  agentId: string | undefined,
): T | undefined {
  const scoped =
    agentId === undefined
      ? undefined
      : entries.find(
          (entry) => entry.name === name && entry.agentId === agentId,
        );
  return (
    scoped ?? entries.find((entry) => entry.name === name && !entry.agentId)
  );
}

/** Resolve the documented application/frontend/wildcard/fallback precedence. */
export function pickToolCallHandler(
  options: PickToolCallHandlerOptions,
): ToolCallHandler | undefined {
  const application = namedForAgent(
    options.application.filter((entry) => entry.name !== "*"),
    options.name,
    options.agentId,
  );
  if (application) return { type: "renderer", config: application };

  const frontend = namedForAgent(
    options.frontend.filter((entry) => entry.component !== undefined),
    options.name,
    options.agentId,
  );
  if (frontend) return { type: "clientTool", config: frontend };

  const humanInTheLoop = namedForAgent(
    options.humanInTheLoop,
    options.name,
    options.agentId,
  );
  if (humanInTheLoop) {
    return { type: "humanInTheLoopTool", config: humanInTheLoop };
  }

  const wildcard = namedForAgent(
    options.application.filter((entry) => entry.name === "*"),
    "*",
    options.agentId,
  );
  if (wildcard) return { type: "renderer", config: wildcard };
  if (options.builtInFallback) {
    return {
      type: "builtIn",
      config: { component: CopilotDefaultToolRenderer },
    };
  }
  return undefined;
}

/**
 * Renders one tool call through the registered renderers. The renderer can
 * inject `TOOL_CALL_RENDER_CONTEXT` for the call's id and, inside a group,
 * the row it is drawn as.
 */
@Component({
  selector: "copilot-render-tool-call",
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @let renderConfig = pickRenderer(toolCall().function.name);
    @if (
      renderConfig &&
      renderConfig.type !== "humanInTheLoopTool" &&
      renderConfig.config.component
    ) {
      <ng-container
        *ngComponentOutlet="
          renderConfig.config.component;
          inputs: buildRendererInputs(toolCall(), renderConfig);
          injector: renderInjector()
        "
      />
    }
    @if (
      renderConfig &&
      renderConfig.type === "humanInTheLoopTool" &&
      renderConfig.config.component
    ) {
      <ng-container
        *ngComponentOutlet="
          renderConfig.config.component;
          inputs: { toolCall: buildHumanInTheLoopToolCall(toolCall()) };
          injector: renderInjector()
        "
      />
    }
  `,
})
export class RenderToolCall {
  readonly #copilotKit = inject(CopilotKit);
  readonly #hitl = inject(HumanInTheLoop);
  readonly #injector = inject(Injector);
  readonly toolCall = input.required<ToolCall>();
  /** The assistant message the call belongs to (or whose group it joined). */
  readonly message = input.required<AssistantMessage>();
  readonly messages = input.required<Message[]>();
  readonly isLoading = input<boolean>(false);
  readonly agentId = input<string | undefined>();
  /** Set by a tool-call group: how the call's row looks. */
  readonly row = input<ToolCallRenderContext["row"]>();

  readonly #toolCallId = computed(() => this.toolCall().id);
  // Depends on the id, not the streamed call, so the renderer isn't recreated
  // on every update.
  protected readonly renderInjector = computed(() =>
    Injector.create({
      providers: [
        {
          provide: TOOL_CALL_RENDER_CONTEXT,
          useValue: {
            toolCallId: this.#toolCallId(),
            row: this.row(),
          } satisfies ToolCallRenderContext,
        },
      ],
      parent: this.#injector,
    }),
  );

  protected pickRenderer(name: string): ToolCallHandler | undefined {
    return pickToolCallHandler({
      name,
      agentId: this.agentId() ?? this.#messageAgentId(),
      application: this.#copilotKit.toolCallRenderConfigs(),
      frontend: this.#copilotKit.clientToolCallRenderConfigs(),
      humanInTheLoop: this.#copilotKit.humanInTheLoopToolRenderConfigs(),
      builtInFallback: this.#copilotKit.defaultToolRenderingEnabled,
    });
  }

  protected buildToolCall<Args extends Record<string, unknown>>(
    toolCall: ToolCall,
  ): AngularToolCall<Args> {
    const args = parseToolCallArguments(
      toolCall.function.arguments,
      this.isLoading(),
    ) as Args;
    const message = this.#getToolMessage(toolCall.id);

    if (message) {
      return {
        name: toolCall.function.name,
        args,
        status: "complete",
        result: contentToText(message.content),
      };
    } else if (this.isLoading()) {
      return {
        name: toolCall.function.name,
        args,
        status: "in-progress",
        result: undefined,
      };
    } else {
      return {
        name: toolCall.function.name,
        args,
        status: "executing",
        result: undefined,
      };
    }
  }

  protected buildRendererInputs<Args extends Record<string, unknown>>(
    toolCall: ToolCall,
    handler:
      | RendererToolCallHandler
      | ClientToolCallHandler
      | BuiltInToolCallHandler,
  ): {
    toolCall: AngularToolCall<Args>;
    agent?: AbstractAgent;
  } {
    const inputs: {
      toolCall: AngularToolCall<Args>;
      agent?: AbstractAgent;
    } = {
      toolCall: this.buildToolCall<Args>(toolCall),
    };

    const shouldPassAgent =
      "passAgent" in handler.config && handler.config.passAgent === true;

    if (!shouldPassAgent) {
      return inputs;
    }

    const agentId = this.agentId() ?? this.#messageAgentId();
    if (!agentId) {
      return inputs;
    }

    const agent = this.#copilotKit.getAgent(agentId);
    if (agent) {
      inputs.agent = agent;
    }

    return inputs;
  }

  protected buildHumanInTheLoopToolCall<Args extends Record<string, unknown>>(
    toolCall: ToolCall,
  ): HumanInTheLoopToolCall<Args> {
    const args = parseToolCallArguments(
      toolCall.function.arguments,
      this.isLoading(),
    ) as Args;
    const message = this.#getToolMessage(toolCall.id);
    const respond = (result: unknown) => {
      this.#hitl.addResult(toolCall.id, toolCall.function.name, result);
    };

    if (message) {
      return {
        name: toolCall.function.name,
        args,
        status: "complete",
        result: contentToText(message.content),
        respond,
      };
    } else if (this.isLoading()) {
      return {
        name: toolCall.function.name,
        args,
        status: "in-progress",
        result: undefined,
        respond,
      };
    } else {
      return {
        name: toolCall.function.name,
        args,
        status: "executing",
        result: undefined,
        respond,
      };
    }
  }

  #getToolMessage(toolCallId: string): ToolMessage | undefined {
    return this.messages().find(
      (m): m is ToolMessage => m.role === "tool" && m.toolCallId === toolCallId,
    );
  }

  #messageAgentId(): string | undefined {
    return (this.message() as AssistantMessage & { agentId?: string }).agentId;
  }
}

/** Renders every tool call of an assistant message, each on its own. */
@Component({
  selector: "copilot-render-tool-calls",
  imports: [RenderToolCall],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @for (toolCall of message().toolCalls ?? []; track toolCall.id) {
      <copilot-render-tool-call
        [toolCall]="toolCall"
        [message]="message()"
        [messages]="messages()"
        [agentId]="agentId()"
        [isLoading]="isLoading()"
      />
    }
  `,
})
export class RenderToolCalls {
  readonly message = input.required<AssistantMessage>();
  readonly messages = input.required<Message[]>();
  readonly isLoading = input<boolean>(false);
  readonly agentId = input<string | undefined>();
}
