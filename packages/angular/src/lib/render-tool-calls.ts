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
import { DEFAULT_AGENT_ID, partialJSONParse } from "@copilotkit/shared";
import { ɵresolveToolCallRenderer } from "@copilotkit/core";
import { HumanInTheLoop } from "./human-in-the-loop";
import { CopilotDefaultToolRenderer } from "./components/tools/default-tool-renderer";
import { TOOL_CALL_RENDER_CONTEXT } from "./components/tools/tool-call-render-context";
import type { ToolCallRenderContext } from "./components/tools/tool-call-render-context";

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

/** One entry of the flat list that core's renderer lookup walks. */
interface ToolCallCandidate {
  name: string;
  agentId?: string;
  handler: ToolCallHandler;
}

/**
 * Pick what draws a tool call. This follows the same rules as React and Vue.
 *
 * The first rule that matches wins:
 *
 * 1. A renderer for `name` with `agentId` equal to the current agent.
 * 2. A renderer for `name` with no `agentId`.
 * 3. The first renderer for `name` from any other agent.
 * 4. The first `"*"` renderer, from any agent.
 * 5. The built-in card, when `builtInFallback` is `true`.
 *
 * Inside rules 1 to 4, `application` renderers come first, then `frontend`
 * tools that have a `component`, then `humanInTheLoop` tools. Inside each
 * group, the earlier entry in its list wins.
 *
 * @param options - The tool name, the current agent, the three renderer
 *   lists, and whether the built-in card may draw unknown tools.
 * @returns The handler to draw with, or `undefined` to draw nothing.
 *
 * @example
 * ```ts
 * const handler = pickToolCallHandler({
 *   name: toolCall.function.name,
 *   agentId: "weather-agent",
 *   application: copilotKit.toolCallRenderConfigs(),
 *   frontend: copilotKit.clientToolCallRenderConfigs(),
 *   humanInTheLoop: copilotKit.humanInTheLoopToolRenderConfigs(),
 *   builtInFallback: copilotKit.defaultToolRenderingEnabled,
 * });
 * ```
 */
export function pickToolCallHandler(
  options: PickToolCallHandlerOptions,
): ToolCallHandler | undefined {
  const frontendWithComponent = options.frontend.filter(
    (config) => config.component !== undefined,
  );
  const candidates: ToolCallCandidate[] = [
    ...options.application.map((config) => ({
      name: config.name,
      agentId: config.agentId,
      handler: { type: "renderer", config } satisfies ToolCallHandler,
    })),
    ...frontendWithComponent.map((config) => ({
      name: config.name,
      agentId: config.agentId,
      handler: { type: "clientTool", config } satisfies ToolCallHandler,
    })),
    ...options.humanInTheLoop.map((config) => ({
      name: config.name,
      agentId: config.agentId,
      handler: { type: "humanInTheLoopTool", config } satisfies ToolCallHandler,
    })),
  ];

  const match = ɵresolveToolCallRenderer(
    candidates,
    options.name,
    options.agentId,
  );
  if (match) return match.handler;
  if (!options.builtInFallback) return undefined;

  return {
    type: "builtIn",
    config: { component: CopilotDefaultToolRenderer },
  };
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
      // React and Vue look up renderers for the default agent when the chat
      // names none, so a renderer scoped to it wins over a global one.
      agentId: this.agentId() ?? this.#messageAgentId() ?? DEFAULT_AGENT_ID,
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
