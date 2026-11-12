import type React from "react";
import { ɵanySchema } from "@copilotkit/shared";
import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import type { ToolCallRenderProps } from "@copilotkit/core";
import type { ReactToolCallRenderer } from "./react-tool-call-renderer";

/**
 * Helper to define a type-safe tool call renderer entry.
 * - Accepts a single object whose keys match ReactToolCallRenderer's fields: { name, args, render, agentId? }.
 * - Derives `args` type from the provided schema (any Standard Schema V1 compatible library).
 * - Ensures the render function param type exactly matches ReactToolCallRenderer<T>["render"]'s param.
 * - For wildcard tools (name: "*"), args is optional and defaults to a schema that accepts any value.
 */
// Overload for wildcard tools without args
export function defineToolCallRenderer(def: {
  name: "*";
  render: (props: ToolCallRenderProps<any>) => React.ReactElement | null;
  agentId?: string;
  group?: boolean;
}): ReactToolCallRenderer<any>;

// Overload for regular tools with args
export function defineToolCallRenderer<S extends StandardSchemaV1>(def: {
  name: string;
  args: S;
  render: (
    props: ToolCallRenderProps<InferSchemaOutput<S>>,
  ) => React.ReactElement | null;
  agentId?: string;
  group?: boolean;
}): ReactToolCallRenderer<InferSchemaOutput<S>>;

// Implementation
export function defineToolCallRenderer<S extends StandardSchemaV1>(def: {
  name: string;
  args?: S;
  render: (props: any) => React.ReactElement | null;
  agentId?: string;
  group?: boolean;
}): ReactToolCallRenderer<any> {
  // For wildcard tools, default to a schema that accepts any value
  const argsSchema = def.name === "*" && !def.args ? ɵanySchema : def.args;

  return {
    name: def.name,
    args: argsSchema,
    render: def.render,
    ...(def.agentId ? { agentId: def.agentId } : {}),
    ...(def.group ? { group: true } : {}),
  };
}
