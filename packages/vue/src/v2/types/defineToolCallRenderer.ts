import { z } from "zod";
import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import type { VueToolCallRenderer } from "./vue-tool-call-renderer";
import type { VueToolCallRendererRenderFn } from "./vue-tool-call-renderer";

export function defineToolCallRenderer(def: {
  name: "*";
  render: VueToolCallRendererRenderFn<unknown>;
  agentId?: string;
}): VueToolCallRenderer<unknown>;

export function defineToolCallRenderer<S extends StandardSchemaV1>(def: {
  name: string;
  args: S;
  render: VueToolCallRendererRenderFn<InferSchemaOutput<S>>;
  agentId?: string;
}): VueToolCallRenderer<InferSchemaOutput<S>>;

export function defineToolCallRenderer<S extends StandardSchemaV1>(def: {
  name: string;
  args?: S;
  render: VueToolCallRendererRenderFn<unknown>;
  agentId?: string;
}): VueToolCallRenderer<unknown> {
  const argsSchema = def.name === "*" && !def.args ? z.any() : def.args;
  return {
    name: def.name,
    args: argsSchema as StandardSchemaV1<any, unknown>,
    render: def.render as VueToolCallRenderer<unknown>["render"],
    ...(def.agentId ? { agentId: def.agentId } : {}),
  };
}
