import { useFrontendTool, ReactFrontendTool } from "./use-frontend-tool";
import { useState, useCallback, useRef } from "react";
import React from "react";
import { z } from "zod";
import { useCopilotAction } from "./use-copilot-action";

export type ReactHumanInTheLoop<T> = {
  name: string;
  description?: string;
  parameters?: z.ZodType<T>;
  render: React.ComponentType<
    | {
        name: string;
        description: string;
        args: Partial<T>;
        status: "inProgress";
        result: undefined;
        respond: undefined;
      }
    | {
        name: string;
        description: string;
        args: T;
        status: "executing";
        result: undefined;
        respond: (result: unknown) => Promise<void>;
      }
    | {
        name: string;
        description: string;
        args: T;
        status: "complete";
        result: unknown;
        respond: undefined;
      }
  >;
};

export function useHumanInTheLoop<T extends Record<string, any> = {}>(
  tool: ReactHumanInTheLoop<T>,
  dependencies?: any[],
) {
  // Convert Zod schema to JSON Schema if parameters are provided
  const jsonSchema = tool.parameters ? JSON.stringify(z.toJSONSchema(tool.parameters)) : undefined;

  // Create a wrapper component that handles the renderAndWaitForResponse pattern
  const renderAndWaitForResponse = tool.render
    ? (props: any) => {
        // Map the props to match the component's expected format
        const componentProps = {
          name: tool.name,
          description: tool.description || "",
          args: props.args,
          status: props.status,
          result: props.result,
          respond: props.respond,
        };
        return React.createElement(tool.render!, componentProps);
      }
    : undefined;

  // Create a FrontendAction that uses renderAndWaitForResponse
  const action: any = {
    name: tool.name,
    description: tool.description,
    renderAndWaitForResponse,
    jsonSchema,
    // Parameters will be undefined since we're using jsonSchema
    parameters: undefined,
    available: "remote",
  };

  // Use the existing useCopilotAction hook
  useCopilotAction(action, dependencies);
}
