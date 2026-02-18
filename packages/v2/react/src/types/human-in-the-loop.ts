import { FrontendTool, ToolCallStatus } from "@copilotkitnext/core";
import React from "react";

export type ReactHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
> = Omit<FrontendTool<T>, "handler"> & {
  render: React.ComponentType<
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
      }
  >;
};
