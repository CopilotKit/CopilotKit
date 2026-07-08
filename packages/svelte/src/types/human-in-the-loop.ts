import type { FrontendTool, ToolCallStatus } from "@copilotkit/core";

export type SvelteHumanInTheLoopRenderProps<T> =
  | {
      name: string;
      description: string;
      args: Partial<T>;
      status: ToolCallStatus.InProgress;
      result: undefined;
      respond: undefined;
    }
  | {
      name: string;
      description: string;
      args: T;
      status: ToolCallStatus.Executing;
      result: undefined;
      respond: (result: unknown) => Promise<void>;
    }
  | {
      name: string;
      description: string;
      args: T;
      status: ToolCallStatus.Complete;
      result: string;
      respond: undefined;
    };

export type SvelteHumanInTheLoopRenderFn<T> = (
  props: SvelteHumanInTheLoopRenderProps<T>,
) => any;

export type SvelteHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
> = Omit<FrontendTool<T>, "handler"> & {
  render: SvelteHumanInTheLoopRenderFn<T>;
};
