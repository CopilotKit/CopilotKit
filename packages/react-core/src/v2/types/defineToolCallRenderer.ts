import React from "react";
import { z } from "zod";
import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import type { ReactToolCallRenderer } from "./react-tool-call-renderer";
import type { ToolCallStatus } from "@copilotkit/core";

/**
 * Helper to define a type-safe tool call renderer entry.
 * - Accepts a single object whose keys match ReactToolCallRenderer's fields: { name, args, render, agentId? }.
 * - Derives `args` type from the provided schema (any Standard Schema V1 compatible library).
 * - Ensures the render function param type exactly matches ReactToolCallRenderer<T>["render"]'s param.
 * - For wildcard tools (name: "*"), args is optional and defaults to z.any()
 */
type RenderProps<T> =
  | {
      name: string;
      toolCallId: string;
      args: Partial<T>;
      status: ToolCallStatus.InProgress;
      result: undefined;
      error?: undefined;
    }
  | {
      name: string;
      toolCallId: string;
      args: T;
      status: ToolCallStatus.Executing;
      result: undefined;
      error?: undefined;
    }
  | {
      name: string;
      toolCallId: string;
      args: T;
      status: ToolCallStatus.Complete;
      result: string;
      /**
       * Set when the tool call failed instead of returning a result. This is
       * the tool message's raw `error` field: usually the failure message,
       * but some history adapters restore it as a bare marker such as
       * `"error"`, and `result` then holds the text the agent was sent
       * (`Error: <message>` when CopilotKit produced it). An adapter can
       * also drop `error` from a restored message entirely, so a missing
       * `error` does not prove that the call succeeded.
       */
      error?: string;
    };

// Overload for wildcard tools without args
export function defineToolCallRenderer(def: {
  name: "*";
  render: (props: RenderProps<any>) => React.ReactElement | null;
  agentId?: string;
  group?: boolean;
}): ReactToolCallRenderer<any>;

// Overload for regular tools with args
export function defineToolCallRenderer<S extends StandardSchemaV1>(def: {
  name: string;
  args: S;
  render: (
    props: RenderProps<InferSchemaOutput<S>>,
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
  // For wildcard tools, default to z.any() if no args provided
  const argsSchema = def.name === "*" && !def.args ? z.any() : def.args;

  return {
    name: def.name,
    args: argsSchema,
    render: def.render as React.ComponentType<any>,
    ...(def.agentId ? { agentId: def.agentId } : {}),
    ...(def.group ? { group: true } : {}),
  };
}
