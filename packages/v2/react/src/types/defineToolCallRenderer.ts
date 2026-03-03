import React from "react";
import { z } from "zod";
import { ReactToolCallRenderer } from "./react-tool-call-renderer";
import { ToolCallStatus } from "@copilotkitnext/core";

/**
 * Helper to define a type-safe tool call renderer entry.
 * - Accepts a single object whose keys match ReactToolCallRenderer's fields: { name, args, render, agentId? }.
 * - Derives `args` type from the provided Zod schema.
 * - Ensures the render function param type exactly matches ReactToolCallRenderer<T>["render"]'s param.
 * - For wildcard tools (name: "*"), args is optional and defaults to z.any()
 */
type RenderProps<T> =
  | {
      name: string;
      args: Partial<T>;
      status: ToolCallStatus.InProgress;
      result: undefined;
    }
  | {
      name: string;
      args: T;
      status: ToolCallStatus.Executing;
      result: undefined;
    }
  | {
      name: string;
      args: T;
      status: ToolCallStatus.Complete;
      result: string;
    };

// Overload for wildcard tools without args
export function defineToolCallRenderer(def: {
  name: "*";
  render: (props: RenderProps<any>) => React.ReactElement;
  agentId?: string;
}): ReactToolCallRenderer<any>;

// Overload for regular tools with args
export function defineToolCallRenderer<S extends z.ZodTypeAny>(def: {
  name: string;
  args: S;
  render: (props: RenderProps<z.infer<S>>) => React.ReactElement;
  agentId?: string;
}): ReactToolCallRenderer<z.infer<S>>;

// Implementation
export function defineToolCallRenderer<S extends z.ZodTypeAny>(def: {
  name: string;
  args?: S;
  render: (props: any) => React.ReactElement;
  agentId?: string;
}): ReactToolCallRenderer<any> {
  // For wildcard tools, default to z.any() if no args provided
  const argsSchema = def.name === "*" && !def.args ? z.any() : def.args;

  return {
    name: def.name,
    args: argsSchema as any,
    render: def.render as React.ComponentType<any>,
    ...(def.agentId ? { agentId: def.agentId } : {}),
  };
}
