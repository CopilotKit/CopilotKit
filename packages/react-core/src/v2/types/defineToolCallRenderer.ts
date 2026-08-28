import React from "react";
import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import type { ReactToolCallRenderer } from "./react-tool-call-renderer";
import type { ToolCallStatus } from "@copilotkit/core";

/**
 * Helper to define a type-safe tool call renderer entry.
 * - Accepts a single object whose keys match ReactToolCallRenderer's fields: { name, args, render, agentId? }.
 * - Derives `args` type from the provided schema (any Standard Schema V1 compatible library).
 * - Ensures the render function param type exactly matches ReactToolCallRenderer<T>["render"]'s param.
 * - For wildcard tools (name: "*"), args is optional and defaults to a
 *   dependency-free schema that accepts any value
 */
type AnyArgsSchema = StandardSchemaV1<unknown, unknown> & {
  "~standard": StandardSchemaV1["~standard"] & {
    jsonSchema: {
      input: () => Record<string, unknown>;
    };
  };
};

const anyArgsSchema: AnyArgsSchema = {
  "~standard": {
    version: 1,
    vendor: "copilotkit",
    validate: (value: unknown) => ({ value }),
    jsonSchema: {
      input: () => ({}),
    },
  },
};

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

// Overload for wildcard tools without args
export function defineToolCallRenderer(def: {
  name: "*";
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
  // Keep wildcard renderers schema-backed without forcing every headless
  // consumer to bundle a particular validation library.
  const argsSchema = def.name === "*" && !def.args ? anyArgsSchema : def.args;

  return {
    name: def.name,
    args: argsSchema,
    render: def.render as React.ComponentType<any>,
    ...(def.agentId ? { agentId: def.agentId } : {}),
  };
}
