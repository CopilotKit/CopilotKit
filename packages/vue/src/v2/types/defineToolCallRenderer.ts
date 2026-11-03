import { ɵanySchema } from "@copilotkit/shared";
import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import type { VueToolCallRenderer } from "./vue-tool-call-renderer";
import type { VueToolCallRendererRenderFn } from "./vue-tool-call-renderer";

export function defineToolCallRenderer(def: {
  name: "*";
  render: VueToolCallRendererRenderFn<unknown>;
  agentId?: string;
  group?: boolean;
}): VueToolCallRenderer<unknown>;

export function defineToolCallRenderer<S extends StandardSchemaV1>(def: {
  name: string;
  args: S;
  render: VueToolCallRendererRenderFn<InferSchemaOutput<S>>;
  agentId?: string;
  group?: boolean;
}): VueToolCallRenderer<InferSchemaOutput<S>>;

export function defineToolCallRenderer<S extends StandardSchemaV1>(def: {
  name: string;
  args?: S;
  render: VueToolCallRendererRenderFn<unknown>;
  agentId?: string;
  group?: boolean;
}): VueToolCallRenderer<unknown> {
  // Only a "*" renderer may leave out `args`; it accepts any arguments.
  const args = def.args ?? ɵanySchema;
  return {
    name: def.name,
    args,
    render: def.render,
    ...(def.agentId ? { agentId: def.agentId } : {}),
    ...(def.group ? { group: true } : {}),
  };
}
