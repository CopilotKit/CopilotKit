import { FrontendTool } from "@copilotkitnext/core";
import type { VueToolCallRenderer } from "./vue-tool-call-renderer";

export type VueFrontendTool<
  T extends Record<string, unknown> = Record<string, unknown>,
> = FrontendTool<T> & {
  render?: VueToolCallRenderer<T>["render"];
};
