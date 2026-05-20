import type { FrontendTool } from "@copilotkit/core";
import type { ReactToolCallRenderer } from "./react-tool-call-renderer";
import type { AgentId } from "./copilotkit-types";

export type ReactFrontendTool<
  T extends Record<string, unknown> = Record<string, unknown>,
  A extends AgentId | undefined = AgentId | undefined,
> = FrontendTool<T, A> & {
  render?: ReactToolCallRenderer<T>["render"];
};
