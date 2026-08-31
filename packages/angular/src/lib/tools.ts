import { DestroyRef, Injector, Signal, Type, inject } from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import { FrontendTool, FrontendToolHandlerContext } from "@copilotkit/core";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import { CopilotKit } from "./copilotkit";

export type AngularToolCall<
  Args extends Record<string, unknown> = Record<string, unknown>,
> =
  | {
      name?: string;
      args: Partial<Args>;
      status: "in-progress";
      result: undefined;
    }
  | {
      name?: string;
      args: Args;
      status: "executing";
      result: undefined;
    }
  | {
      name?: string;
      args: Args;
      status: "complete";
      result: string;
    };

export type HumanInTheLoopToolCall<
  Args extends Record<string, unknown> = Record<string, unknown>,
> =
  | {
      name?: string;
      args: Partial<Args>;
      status: "in-progress";
      result: undefined;
      respond: (result: unknown) => void;
    }
  | {
      name?: string;
      args: Args;
      status: "executing";
      result: undefined;
      respond: (result: unknown) => void;
    }
  | {
      name?: string;
      args: Args;
      status: "complete";
      result: string;
      respond: (result: unknown) => void;
    };

export interface ToolRenderer<
  Args extends Record<string, unknown> = Record<string, unknown>,
> {
  toolCall: Signal<AngularToolCall<Args>>;
  agent?: Signal<AbstractAgent | undefined>;
}

export interface HumanInTheLoopToolRenderer<
  Args extends Record<string, unknown> = Record<string, unknown>,
> {
  toolCall: Signal<HumanInTheLoopToolCall<Args>>;
}

export type ClientTool<
  Args extends Record<string, unknown> = Record<string, unknown>,
> = Omit<FrontendTool<Args>, "handler"> & {
  renderer?: Type<ToolRenderer<Args>>;
};

export interface RenderToolCallConfig<
  Args extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string;
  args: StandardSchemaV1<unknown, Args>;
  component: Type<ToolRenderer<Args>>;
  agentId?: string;
  passAgent?: boolean;
}

export interface FrontendToolConfig<
  Args extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string;
  description: string;
  parameters: StandardSchemaV1<unknown, Args>;
  component?: Type<ToolRenderer<Args>>;
  /**
   * Application code the agent runs by calling this tool.
   *
   * Optional, because a display-only registration has none: the agent calls the
   * tool to show `component` and nothing else happens. Core inserts an empty tool
   * result for a tool that declares no handler, so leaving this out completes the
   * turn without writing an invented result into the thread. Prefer
   * `registerComponent` for that case -- it is this shape with the model-facing
   * description built for you.
   */
  handler?: (
    args: Args,
    context: FrontendToolHandlerContext,
  ) => Promise<unknown>;
  followUp?: boolean;
  agentId?: string;
}

/**
 * A component the agent can render in chat, with no application code behind it.
 *
 * The Angular counterpart of react-core's and vue's `useComponent`. It carries no
 * `handler` field at all rather than an optional one: a display-only component
 * that quietly ran application code would be a different feature, and a caller
 * who wants both wants `registerFrontendTool`.
 */
export interface RegisterComponentConfig<
  Args extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string;
  description?: string;
  parameters: StandardSchemaV1<unknown, Args>;
  component: Type<ToolRenderer<Args>>;
  agentId?: string;
  followUp?: boolean;
}

export interface HumanInTheLoopConfig<
  Args extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string;
  description: string;
  parameters: StandardSchemaV1<unknown, Args>;
  component: Type<HumanInTheLoopToolRenderer<Args>>;
  agentId?: string;
}

export function registerRenderToolCall<
  Args extends Record<string, unknown> = Record<string, unknown>,
>(renderToolCall: RenderToolCallConfig<Args>): void {
  const copilotKit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);

  copilotKit.addRenderToolCall(renderToolCall);

  destroyRef.onDestroy(() => {
    copilotKit.removeTool(renderToolCall.name, renderToolCall.agentId);
  });
}

export function registerFrontendTool<
  Args extends Record<string, unknown> = Record<string, unknown>,
>(frontendTool: FrontendToolConfig<Args>): void {
  const injector = inject(Injector);
  const destroyRef = inject(DestroyRef);
  const copilotKit = inject(CopilotKit);

  copilotKit.addFrontendTool({
    ...(frontendTool as FrontendToolConfig),
    injector,
  });

  destroyRef.onDestroy(() => {
    copilotKit.removeTool(frontendTool.name, frontendTool.agentId);
  });
}

/**
 * Registers an Angular component as a tool the agent can call to display it.
 *
 * The simplest generative-UI registration there is, and the only one that needs
 * nothing on the agent side: the tool is declared by the frontend and forwarded to
 * the agent over AG-UI, so it works the same behind a Python agent as a TypeScript
 * one. Contrast `registerRenderToolCall`, which draws a tool the agent already
 * has and therefore requires that tool to exist in the agent.
 *
 * The component is an ordinary `ToolRenderer`: it takes the required `toolCall`
 * signal input and reads `toolCall().args`, exactly as it would under
 * `registerFrontendTool` or `registerRenderToolCall`.
 *
 * Registration is removed when the calling injector is destroyed.
 *
 * @param config - Name, parameter schema, and component to render.
 *
 * @example
 * ```ts
 * registerComponent({
 *   name: "show_incident",
 *   description: "Show one incident from the incident table.",
 *   parameters: z.object({ id: z.string(), severity: z.string() }),
 *   component: IncidentCardComponent,
 * });
 * ```
 */
export function registerComponent<
  Args extends Record<string, unknown> = Record<string, unknown>,
>(config: RegisterComponentConfig<Args>): void {
  // The same prefix react-core and vue build, so the tool reads identically to the
  // model whichever frontend registered the component.
  const prefix = `Use this tool to display the "${config.name}" component in the chat. This tool renders a visual UI component for the user.`;

  registerFrontendTool<Args>({
    name: config.name,
    description: config.description
      ? `${prefix}\n\n${config.description}`
      : prefix,
    parameters: config.parameters,
    component: config.component,
    agentId: config.agentId,
    followUp: config.followUp,
  });
}

export function registerHumanInTheLoop<
  Args extends Record<string, unknown> = Record<string, unknown>,
>(humanInTheLoop: HumanInTheLoopConfig<Args>): void {
  const destroyRef = inject(DestroyRef);
  const copilotKit = inject(CopilotKit);

  copilotKit.addHumanInTheLoop(humanInTheLoop);

  destroyRef.onDestroy(() => {
    copilotKit.removeTool(humanInTheLoop.name, humanInTheLoop.agentId);
  });
}
