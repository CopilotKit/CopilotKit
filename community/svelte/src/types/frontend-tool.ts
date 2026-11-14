import type { FrontendTool } from "@copilotkit/core";
import type { SvelteToolCallRenderer } from "./tool-call-renderer";

export type SvelteFrontendTool<
  T extends Record<string, unknown> = Record<string, unknown>,
> = FrontendTool<T> & {
  render?: SvelteToolCallRenderer<T>["render"];
};
