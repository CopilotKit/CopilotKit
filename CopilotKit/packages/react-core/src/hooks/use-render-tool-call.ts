import { z } from "zod";
import React from "react";
import { useCopilotAction } from "./use-copilot-action";
import { zodToJsonSchema } from "zod-to-json-schema";

export type ReactRenderToolCall<T> = {
  name: string;
  description?: string;
  parameters?: z.ZodType<T>;
  render?: React.ComponentType<
    | {
        name: string;
        description: string;
        args: Partial<T>;
        status: "inProgress";
        result: undefined;
      }
    | {
        name: string;
        description: string;
        args: T;
        status: "executing";
        result: undefined;
      }
    | {
        name: string;
        description: string;
        args: T;
        status: "complete";
        result: any;
      }
  >;
};

export function useRenderToolCall<T extends Record<string, any> = {}>(
  tool: ReactRenderToolCall<T>,
  dependencies?: any[],
) {
  // Convert Zod schema to JSON Schema if parameters are provided
  const jsonSchema = tool.parameters ? JSON.stringify(zodToJsonSchema(tool.parameters)) : undefined;

  // Convert render function to match FrontendAction expectations
  const render = tool.render
    ? (props: any) => {
        // Map the props to match the component's expected format
        const componentProps = {
          name: tool.name,
          description: tool.description || "",
          args: props.args,
          status: props.status,
          result: props.result,
        };
        return React.createElement(tool.render!, componentProps);
      }
    : undefined;

  useCopilotAction(
    {
      name: tool.name,
      description: tool.description,
      jsonSchema,
      render,
      // Parameters will be undefined since we're using jsonSchema
      parameters: undefined,
      available: "frontend",
    } as any,
    dependencies,
  );
}
