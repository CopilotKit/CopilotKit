import React from "react";
import { z } from "zod";
import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import { ReactToolCallRenderer } from "./react-tool-call-renderer";
import { ToolCallStatus } from "@copilotkit/core";

/**
 * Helper to define a type-safe tool call renderer entry.
 * - Accepts a single object whose keys match ReactToolCallRenderer's fields: { name, args, render, agentId? }.
 * - Derives `args` type from the provided schema (any Standard Schema V1 compatible library).
 * - Ensures the render function param type exactly matches ReactToolCallRenderer<T>["render"]'s param.
 * - When no `args` schema is provided (wildcard `"*"` or a render-only named entry), it defaults to z.any().
 */
type RenderProps<T> =
  | {
      name: string;
      toolCallId: string;
      args: Partial<T>;
      status: ToolCallStatus.InProgress;
      result: undefined;
    }
  | {
      name: string;
      toolCallId: string;
      args: T;
      status: ToolCallStatus.Executing;
      result: undefined;
    }
  | {
      name: string;
      toolCallId: string;
      args: T;
      status: ToolCallStatus.Complete;
      result: string;
    };

// Overload for renderers without an args schema (wildcard `"*"` or a
// render-only named entry, e.g. opting out of the default rendering).
export function defineToolCallRenderer(def: {
  name: string;
  render: (props: RenderProps<any>) => React.ReactElement;
  agentId?: string;
}): ReactToolCallRenderer<any>;

// Overload for regular tools with args
export function defineToolCallRenderer<S extends StandardSchemaV1>(def: {
  name: string;
  args: S;
  render: (props: RenderProps<InferSchemaOutput<S>>) => React.ReactElement;
  agentId?: string;
}): ReactToolCallRenderer<InferSchemaOutput<S>>;

// Implementation
export function defineToolCallRenderer<S extends StandardSchemaV1>(def: {
  name: string;
  args?: S;
  render: (props: any) => React.ReactElement;
  agentId?: string;
}): ReactToolCallRenderer<any> {
  // Default to z.any() when no args schema is provided (wildcard or
  // render-only named entry). Such renderers ignore parameters.
  const argsSchema = def.args ?? z.any();

  return {
    name: def.name,
    args: argsSchema,
    render: def.render as React.ComponentType<any>,
    ...(def.agentId ? { agentId: def.agentId } : {}),
  };
}
