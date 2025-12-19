import { DestroyRef, Injector, Signal, Type, inject } from "@angular/core";
import { FrontendTool } from "@copilotkitnext/core";
import { z } from "zod";
import { CopilotKit } from "./copilotkit";

export type AngularToolCall<Args extends Record<string, unknown> = Record<string, unknown>> =
  | {
      args: Partial<Args>;
      status: "in-progress";
      result: undefined;
    }
  | {
      args: Args;
      status: "executing";
      result: undefined;
    }
  | {
      args: Args;
      status: "complete";
      result: string;
    };

export type HumanInTheLoopToolCall<Args extends Record<string, unknown> = Record<string, unknown>> =
  | {
      args: Partial<Args>;
      status: "in-progress";
      result: undefined;
      respond: (result: unknown) => void;
    }
  | {
      args: Args;
      status: "executing";
      result: undefined;
      respond: (result: unknown) => void;
    }
  | {
      args: Args;
      status: "complete";
      result: string;
      respond: (result: unknown) => void;
    };

export interface ToolRenderer<Args extends Record<string, unknown> = Record<string, unknown>> {
  toolCall: Signal<AngularToolCall<Args>>;
}

export interface HumanInTheLoopToolRenderer<Args extends Record<string, unknown> = Record<string, unknown>> {
  toolCall: Signal<HumanInTheLoopToolCall<Args>>;
}

export type ClientTool<Args extends Record<string, unknown> = Record<string, unknown>> = Omit<
  FrontendTool<Args>,
  "handler"
> & {
  renderer?: Type<ToolRenderer<Args>>;
};

export interface RenderToolCallConfig<Args extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  args: z.ZodType<Args>;
  component: Type<ToolRenderer<Args>>;
  agentId?: string;
}

export interface FrontendToolConfig<Args extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: z.ZodType<Args>;
  component?: Type<ToolRenderer<Args>>;
  handler: (args: Args) => Promise<unknown>;
  agentId?: string;
}

export interface HumanInTheLoopConfig<Args extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: z.ZodType<Args>;
  component: Type<HumanInTheLoopToolRenderer<Args>>;
  agentId?: string;
}

export function registerRenderToolCall<Args extends Record<string, unknown> = Record<string, unknown>>(
  renderToolCall: RenderToolCallConfig<Args>,
): void {
  const copilotKit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);

  copilotKit.addRenderToolCall(renderToolCall);

  destroyRef.onDestroy(() => {
    copilotKit.removeTool(renderToolCall.name, renderToolCall.agentId);
  });
}

export function registerFrontendTool<Args extends Record<string, unknown> = Record<string, unknown>>(
  frontendTool: FrontendToolConfig<Args>,
): void {
  const injector = inject(Injector);
  const destroyRef = inject(DestroyRef);
  const copilotKit = inject(CopilotKit);

  copilotKit.addFrontendTool({
    ...(frontendTool as FrontendToolConfig),
    injector,
  });

  destroyRef.onDestroy(() => {
    copilotKit.removeTool(frontendTool.name);
  });
}

export function registerHumanInTheLoop<Args extends Record<string, unknown> = Record<string, unknown>>(
  humanInTheLoop: HumanInTheLoopConfig<Args>,
): void {
  const destroyRef = inject(DestroyRef);
  const copilotKit = inject(CopilotKit);

  copilotKit.addHumanInTheLoop(humanInTheLoop);

  destroyRef.onDestroy(() => {
    copilotKit.removeTool(humanInTheLoop.name);
  });
}
