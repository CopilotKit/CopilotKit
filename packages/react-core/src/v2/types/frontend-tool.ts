import { FrontendTool } from "@copilotkit/core";
import { ReactToolCallRenderer } from "./react-tool-call-renderer";

export type ReactFrontendTool<
  T extends Record<string, unknown> = Record<string, unknown>,
> = FrontendTool<T> & {
  render?: ReactToolCallRenderer<T>["render"];
};
