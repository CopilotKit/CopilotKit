import { FrontendTool, ToolCallStatus } from "@copilotkitnext/core";
import React from "react";
import type { AgentId, ToolName } from "./copilotkit-types";

export type ReactHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
  A extends AgentId | undefined = AgentId | undefined,
  TName extends string = ToolName<A extends string ? A : undefined>,
> = Omit<FrontendTool<T, TName, A>, "handler"> & {
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
