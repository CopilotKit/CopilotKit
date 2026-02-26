import { FrontendTool } from "@copilotkitnext/core";
import { ReactToolCallRenderer } from "./react-tool-call-renderer";
import type { AgentId, ToolName } from "./copilotkit-types";

export type ReactFrontendTool<
  T extends Record<string, unknown> = Record<string, unknown>,
  A extends AgentId | undefined = AgentId | undefined,
  TName extends string = ToolName<A extends string ? A : undefined>,
> = FrontendTool<T, TName, A> & {
  render?: ReactToolCallRenderer<T>["render"];
};
