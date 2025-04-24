import { Action, Parameter } from "@copilotkit/shared";

/**
 * Represents a tool provided by an MCP server.
 */
export interface MCPTool {
  description?: string;
  /** Schema defining parameters, mirroring the MCP structure. */
  schema?: {
    parameters?: {
      properties?: Record<string, any>;
      required?: string[];
    };
  };
  /** The function to call to execute the tool on the MCP server. */
  execute(options: { params: any }): Promise<any>;
}

/**
 * Defines the contract for *any* MCP client implementation the user might provide.
 */
export interface MCPClient {
  /** A method that returns a map of tool names to MCPTool objects available from the connected MCP server. */
  tools(): Promise<Record<string, MCPTool>>;
  /** An optional method for cleanup if the underlying client requires explicit disconnection. */
  close?(): Promise<void>;
}

/**
 * Configuration for connecting to an MCP endpoint.
 */
export interface MCPEndpointConfig {
  endpoint: string;
  apiKey?: string;
}

/**
 * Extracts CopilotKit-compatible parameters from an MCP tool schema.
 * @param toolSchema The schema object from an MCPTool.
 * @returns An array of Parameter objects.
 */
export function extractParametersFromSchema(toolSchema?: MCPTool["schema"]): Parameter[] {
  const parameters: Parameter[] = [];
  const toolParameters =
    toolSchema?.parameters || toolSchema?.parameters?.jsonSchema;
  const properties = toolParameters?.properties;
  const requiredParams = new Set(toolParameters?.required || []);

  if (!properties) {
    return parameters;
  }

  for (const paramName in properties) {
    if (Object.prototype.hasOwnProperty.call(properties, paramName)) {
      const paramDef = properties[paramName];
      parameters.push({
        name: paramName,
        // Infer type, default to string. MCP schemas might have more complex types.
        // This might need refinement based on common MCP schema practices.
        type: paramDef.type || "string",
        description: paramDef.description,
        required: requiredParams.has(paramName),
        // Attributes might not directly map, handle if necessary
        // attributes: paramDef.attributes || undefined,
      });
    }
  }

  return parameters;
}

/**
 * Converts a map of MCPTools into an array of CopilotKit Actions.
 * @param mcpTools A record mapping tool names to MCPTool objects.
 * @param mcpEndpoint The endpoint URL from which these tools were fetched.
 * @returns An array of Action<any> objects.
 */
export function convertMCPToolsToActions(
  mcpTools: Record<string, MCPTool>,
  mcpEndpoint: string,
): Action<any>[] {
  const actions: Action<any>[] = [];

  for (const [toolName, tool] of Object.entries(mcpTools)) {
    const parameters = extractParametersFromSchema(tool.schema || tool);

    const handler = async (params: any): Promise<any> => {
      try {
        const result = await tool.execute({ params });
        // Ensure the result is a string or stringify it, as required by many LLMs.
        // This might need adjustment depending on how different LLMs handle tool results.
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (error) {
        console.error(
          `Error executing MCP tool '${toolName}' from endpoint ${mcpEndpoint}:`,
          error,
        );
        // Re-throw or format the error for the LLM
        throw new Error(
          `Execution failed for MCP tool '${toolName}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    actions.push({
      name: toolName,
      description: tool.description || `MCP tool: ${toolName} (from ${mcpEndpoint})`,
      parameters: parameters,
      handler: handler,
      // Add metadata for easier identification/debugging
      _isMCPTool: true,
      _mcpEndpoint: mcpEndpoint,
    } as Action<any> & { _isMCPTool: boolean; _mcpEndpoint: string }); // Type assertion for metadata
  }

  return actions;
}
