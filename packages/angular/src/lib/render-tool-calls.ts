import { NgComponentOutlet } from "@angular/common";
import { Component, inject, input } from "@angular/core";
import {
  AssistantMessage,
  Message,
  ToolCall,
  ToolMessage,
} from "@ag-ui/client";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKit } from "./copilotkit";
import {
  FrontendToolConfig,
  HumanInTheLoopToolCall,
  HumanInTheLoopConfig,
  AngularToolCall,
  RenderToolCallConfig,
} from "./tools";
import { partialJSONParse } from "@copilotkit/shared";
import { HumanInTheLoop } from "./human-in-the-loop";
import { CopilotDefaultToolRenderer } from "./components/tools/default-tool-renderer";

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

@Component({
  selector: "copilot-render-tool-calls",
  imports: [NgComponentOutlet],
  template: `
    @for (toolCall of message().toolCalls ?? []; track toolCall.id) {
      @let renderConfig = pickRenderer(toolCall.function.name);
      @if (
        renderConfig &&
        renderConfig.type !== "humanInTheLoopTool" &&
        renderConfig.config.component
      ) {
        <ng-container
          *ngComponentOutlet="
            renderConfig.config.component;
            inputs: buildRendererInputs(toolCall, renderConfig)
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
            inputs: { toolCall: buildHumanInTheLoopToolCall(toolCall) }
          "
        />
      }
    }
  `,
})
export class RenderToolCalls {
  readonly #copilotKit = inject(CopilotKit);
  readonly #hitl = inject(HumanInTheLoop);
  readonly message = input.required<AssistantMessage>();
  readonly messages = input.required<Message[]>();
  readonly isLoading = input<boolean>(false);
  readonly agentId = input<string | undefined>();

  protected pickRenderer(name: string): ToolCallHandler | undefined {
    type AssistantMessageWithAgent = AssistantMessage & {
      agentId?: string;
    };
    const messageAgentId = (this.message() as AssistantMessageWithAgent)
      .agentId;
    const renderers = this.#copilotKit.toolCallRenderConfigs();
    const clientTools = this.#copilotKit.clientToolCallRenderConfigs();
    const humanInTheLoopTools =
      this.#copilotKit.humanInTheLoopToolRenderConfigs();

    return pickToolCallHandler({
      name,
      agentId: this.agentId() ?? messageAgentId,
      application: renderers,
      frontend: clientTools,
      humanInTheLoop: humanInTheLoopTools,
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
        result: message.content,
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
        result: message.content!,
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
    const message = this.messages().find(
      (m): m is ToolMessage => m.role === "tool" && m.toolCallId === toolCallId,
    );

    return message;
  }

  #messageAgentId(): string | undefined {
    return (this.message() as AssistantMessage & { agentId?: string }).agentId;
  }
}
