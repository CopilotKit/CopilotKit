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
      jsonSchema?: Record<string, any>;
    };
  };
  /** The function to call to execute the tool on the MCP server. */
  execute(params: any): Promise<any>;
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
 * @param toolOrSchema The schema object from an MCPTool or the full MCPTool object.
 * @returns An array of Parameter objects.
 */
export function extractParametersFromSchema(
  toolOrSchema?: MCPTool | MCPTool["schema"],
): Parameter[] {
  const parameters: Parameter[] = [];

  // Handle either full tool object or just schema
  const schema =
    "schema" in (toolOrSchema || {})
      ? (toolOrSchema as MCPTool).schema
      : (toolOrSchema as MCPTool["schema"]);

  const toolParameters = schema?.parameters?.jsonSchema || schema?.parameters;
  const properties = toolParameters?.properties;
  const requiredParams = new Set(toolParameters?.required || []);

  if (!properties) {
    return parameters;
  }

  for (const paramName in properties) {
    if (Object.prototype.hasOwnProperty.call(properties, paramName)) {
      const paramDef = properties[paramName];

      // Enhanced type extraction with support for complex types
      let type = paramDef.type || "string";
      let description = paramDef.description || "";

      // Handle arrays with items
      if (type === "array" && paramDef.items) {
        const itemType = paramDef.items.type || "object";
        if (itemType === "object" && paramDef.items.properties) {
          // For arrays of objects, describe the structure
          const itemProperties = Object.keys(paramDef.items.properties).join(", ");
          description =
            description +
            (description ? " " : "") +
            `Array of objects with properties: ${itemProperties}`;
        } else {
          // For arrays of primitives
          type = `array<${itemType}>`;
        }
      }

      // Handle enums
      if (paramDef.enum && Array.isArray(paramDef.enum)) {
        const enumValues = paramDef.enum.join(" | ");
        description = description + (description ? " " : "") + `Allowed values: ${enumValues}`;
      }

      // Handle objects with properties
      if (type === "object" && paramDef.properties) {
        const objectProperties = Object.keys(paramDef.properties).join(", ");
        description =
          description + (description ? " " : "") + `Object with properties: ${objectProperties}`;
      }

      parameters.push({
        name: paramName,
        type: type,
        description: description,
        required: requiredParams.has(paramName),
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
    const parameters = extractParametersFromSchema(tool);

    const handler = async (params: any): Promise<any> => {
      try {
        const result = await tool.execute(params);
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

/**
 * Generate better instructions for using MCP tools
 * This is used to enhance the system prompt with tool documentation
 */
export function generateMcpToolInstructions(toolsMap: Record<string, MCPTool>): string {
  if (!toolsMap || Object.keys(toolsMap).length === 0) {
    return "";
  }

  const toolEntries = Object.entries(toolsMap);

  // Generate documentation for each tool
  const toolsDoc = toolEntries
    .map(([name, tool]) => {
      // Extract schema information if available
      let paramsDoc = "    No parameters required";

      try {
        if (tool.schema && typeof tool.schema === "object") {
          const schema = tool.schema as any;

          // Extract parameters from JSON Schema - check both schema.parameters.properties and schema.properties
          const toolParameters = schema.parameters?.jsonSchema || schema.parameters;
          const properties = toolParameters?.properties || schema.properties;
          const requiredParams = toolParameters?.required || schema.required || [];

          if (properties) {
            // Build parameter documentation from properties with enhanced type information
            const paramsList = Object.entries(properties).map(([paramName, propSchema]) => {
              const propDetails = propSchema as any;
              const requiredMark = requiredParams.includes(paramName) ? "*" : "";
              let typeInfo = propDetails.type || "any";
              let description = propDetails.description ? ` - ${propDetails.description}` : "";

              // Enhanced type display for complex schemas
              if (typeInfo === "array" && propDetails.items) {
                const itemType = propDetails.items.type || "object";
                if (itemType === "object" && propDetails.items.properties) {
                  const itemProps = Object.keys(propDetails.items.properties).join(", ");
                  typeInfo = `array<object>`;
                  description =
                    description +
                    (description ? " " : " - ") +
                    `Array of objects with properties: ${itemProps}`;
                } else {
                  typeInfo = `array<${itemType}>`;
                }
              }

              // Handle enums
              if (propDetails.enum && Array.isArray(propDetails.enum)) {
                const enumValues = propDetails.enum.join(" | ");
                description =
                  description + (description ? " " : " - ") + `Allowed values: ${enumValues}`;
              }

              // Handle objects
              if (typeInfo === "object" && propDetails.properties) {
                const objectProps = Object.keys(propDetails.properties).join(", ");
                description =
                  description +
                  (description ? " " : " - ") +
                  `Object with properties: ${objectProps}`;
              }

              return `    - ${paramName}${requiredMark} (${typeInfo})${description}`;
            });

            if (paramsList.length > 0) {
              paramsDoc = paramsList.join("\n");
            }
          }
        }
      } catch (e) {
        console.error(`Error parsing schema for tool ${name}:`, e);
      }

      return `- ${name}: ${tool.description || ""}
${paramsDoc}`;
    })
    .join("\n\n");

  return `You have access to the following external tools provided by Model Context Protocol (MCP) servers:

${toolsDoc}

When using these tools:
1. Only provide valid parameters according to their type requirements
2. Required parameters are marked with *
3. For array parameters, provide data in the correct array format
4. For object parameters, include all required nested properties
5. For enum parameters, use only the allowed values listed
6. Format API calls correctly with the expected parameter structure
7. Always check tool responses to determine your next action`;
}
