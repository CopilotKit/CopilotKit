import { z } from "zod";
import { useCopilotAction } from "./use-copilot-action";
import { FrontendAction } from "../types/frontend-action";
import React from "react";

export type ReactFrontendTool<T> = {
  name: string;
  description?: string;
  parameters?: z.ZodType<T>;
  handler?: (args: T) => Promise<unknown>;
  followUp?: boolean;
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

export function useFrontendTool<T extends Record<string, any> = {}>(
  tool: ReactFrontendTool<T>,
  dependencies?: any[],
) {
  // Convert Zod schema to JSON Schema if parameters are provided
  const jsonSchema = tool.parameters ? JSON.stringify(z.toJSONSchema(tool.parameters)) : undefined;

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

  // Create a FrontendAction that matches the expected type
  const action: FrontendAction<any> = {
    name: tool.name,
    description: tool.description,
    handler: tool.handler as any,
    render,
    followUp: tool.followUp,
    jsonSchema,
    // Parameters will be undefined since we're using jsonSchema
    parameters: undefined,
  };

  // Use the existing useCopilotAction hook
  useCopilotAction(action, dependencies);
}
