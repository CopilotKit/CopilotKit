import { NgComponentOutlet } from "@angular/common";
import { Component, inject, input } from "@angular/core";
import { AssistantMessage, Message, ToolCall, ToolMessage } from "@ag-ui/client";
import { CopilotKit } from "./copilotkit";
import {
  FrontendToolConfig,
  HumanInTheLoopToolCall,
  HumanInTheLoopConfig,
  AngularToolCall,
  RenderToolCallConfig,
} from "./tools";
import { partialJSONParse } from "@copilotkitnext/shared";
import { HumanInTheLoop } from "./human-in-the-loop";

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

type ToolCallHandler = RendererToolCallHandler | ClientToolCallHandler | HumanInTheLoopToolCallHandler;

@Component({
  selector: "copilot-render-tool-calls",
  standalone: true,
  imports: [NgComponentOutlet],
  template: `
    @for (toolCall of message().toolCalls ?? []; track toolCall.id) {
      @let renderConfig = pickRenderer(toolCall.function.name);
      @if (renderConfig && renderConfig.type !== "humanInTheLoopTool" && renderConfig.config.component) {
        <ng-container
          *ngComponentOutlet="renderConfig.config.component; inputs: { toolCall: buildToolCall(toolCall) }"
        />
      }
      @if (renderConfig && renderConfig.type === "humanInTheLoopTool" && renderConfig.config.component) {
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

  protected pickRenderer(name: string): ToolCallHandler | undefined {
    type AssistantMessageWithAgent = AssistantMessage & {
      agentId?: string;
    };
    const messageAgentId = (this.message() as AssistantMessageWithAgent).agentId;
    const renderers = this.#copilotKit.toolCallRenderConfigs();
    const clientTools = this.#copilotKit.clientToolCallRenderConfigs();
    const humanInTheLoopTools = this.#copilotKit.humanInTheLoopToolRenderConfigs();

    const renderer = renderers.find(
      (candidate) =>
        candidate.name === name && (candidate.agentId === undefined || candidate.agentId === messageAgentId),
    );

    if (renderer) return { type: "renderer", config: renderer };

    const clientTool = clientTools.find(
      (candidate) =>
        candidate.name === name && (candidate.agentId === undefined || candidate.agentId === messageAgentId),
    );
    if (clientTool) return { type: "clientTool", config: clientTool };

    const humanInTheLoopTool = humanInTheLoopTools.find(
      (candidate) =>
        candidate.name === name && (candidate.agentId === undefined || candidate.agentId === messageAgentId),
    );
    if (humanInTheLoopTool) return { type: "humanInTheLoopTool", config: humanInTheLoopTool };

    const starRenderer = renderers.find((candidate) => candidate.name === "*");
    if (starRenderer) return { type: "renderer", config: starRenderer };

    return undefined;
  }

  protected buildToolCall<Args extends Record<string, unknown>>(toolCall: ToolCall): AngularToolCall<Args> {
    const args = partialJSONParse(toolCall.function.arguments);
    const message = this.#getToolMessage(toolCall.id);

    if (message) {
      return {
        args,
        status: "complete",
        result: message.content,
      };
    } else if (this.isLoading()) {
      return {
        args,
        status: "in-progress",
        result: undefined,
      };
    } else {
      return {
        args,
        status: "executing",
        result: undefined,
      };
    }
  }

  protected buildHumanInTheLoopToolCall<Args extends Record<string, unknown>>(
    toolCall: ToolCall,
  ): HumanInTheLoopToolCall<Args> {
    const args = partialJSONParse(toolCall.function.arguments);
    const message = this.#getToolMessage(toolCall.id);
    const respond = (result: unknown) => {
      this.#hitl.addResult(toolCall.id, toolCall.function.name, result);
    };

    if (message) {
      return {
        args,
        status: "complete",
        result: message.content!,
        respond,
      };
    } else if (this.isLoading()) {
      return {
        args,
        status: "in-progress",
        result: undefined,
        respond,
      };
    } else {
      return {
        args,
        status: "executing",
        result: undefined,
        respond,
      };
    }
  }

  #getToolMessage(toolCallId: string): ToolMessage | undefined {
    const message = this.messages().find((m): m is ToolMessage => m.role === "tool" && m.toolCallId === toolCallId);

    return message;
  }
}
