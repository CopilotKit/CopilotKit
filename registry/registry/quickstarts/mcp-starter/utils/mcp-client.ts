import { MCPTool, MCPClient as MCPClientInterface } from "@copilotkit/runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export interface McpClientOptions {
  serverUrl: string;
  headers?: Record<string, string>;
  onMessage?: (message: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

/**
 * McpClient - A Model Context Protocol client implementation
 *
 * This class implements the Model Context Protocol (MCP) client, which allows for
 * standardized communication with MCP servers. It's designed to be compatible with
 * CopilotKit's runtime by exposing the required interface.
 *
 * The main methods required by CopilotKit are:
 * - tools(): Returns a map of tool names to MCPTool objects
 * - close(): Closes the connection to the MCP server
 */
export class MCPClient implements MCPClientInterface {
  private client: Client;
  private transport: SSEClientTransport;
  private serverUrl: URL;
  private onMessage: (message: Record<string, unknown>) => void;
  private onError: (error: Error) => void;
  private onOpen: () => void;
  private onClose: () => void;
  private isConnected = false;
  private headers?: Record<string, string>;

  // Cache for tools to avoid repeated fetches
  private toolsCache: Record<string, MCPTool> | null = null;

  constructor(options: McpClientOptions) {
    this.serverUrl = new URL(options.serverUrl);
    this.headers = options.headers;
    this.onMessage =
      options.onMessage ||
      ((message) => console.log("Message received:", message));
    this.onError =
      options.onError || ((error) => console.error("Error:", error));
    this.onOpen = options.onOpen || (() => console.log("Connection opened"));
    this.onClose = options.onClose || (() => console.log("Connection closed"));

    // Initialize the SSE transport with headers
    this.transport = new SSEClientTransport(this.serverUrl, this.headers);

    // Initialize the client
    this.client = new Client({
      name: "cpk-mcp-client",
      version: "0.0.1",
    });

    // Set up event handlers
    this.transport.onmessage = this.handleMessage.bind(this);
    this.transport.onerror = this.handleError.bind(this);
    this.transport.onclose = this.handleClose.bind(this);
  }

  private handleMessage(message: JSONRPCMessage): void {
    try {
      this.onMessage(message as Record<string, unknown>);
    } catch (error) {
      this.onError(
        error instanceof Error
          ? error
          : new Error(`Failed to handle message: ${error}`)
      );
    }
  }

  private handleError(error: Error): void {
    this.onError(error);
    if (this.isConnected) {
      this.isConnected = false;
      // Could implement reconnection logic here
    }
  }

  private handleClose(): void {
    this.isConnected = false;
    this.onClose();
  }

  /**
   * Connects to the MCP server using SSE
   */
  public async connect(): Promise<void> {
    try {
      console.log("Connecting to MCP server:", this.serverUrl.href);

      // Connect the client (which connects the transport)
      await this.client.connect(this.transport);

      this.isConnected = true;
      console.log("Connected to MCP server");
      this.onOpen();
    } catch (error) {
      console.error("Failed to connect to MCP server:", error);
      this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Returns a map of tool names to MCPTool objects
   * This method matches the expected CopilotKit interface
   */
  public async tools(): Promise<Record<string, MCPTool>> {
    try {
      // Return from cache if available
      if (this.toolsCache) {
        return this.toolsCache;
      }

      // Fetch raw tools data
      const rawToolsResult = await this.client.listTools();

      // Transform to the expected format
      const toolsMap: Record<string, MCPTool> = {};

      if (rawToolsResult) {
        // If the result has a 'tools' property with an array of tools
        if (
          typeof rawToolsResult === "object" &&
          "tools" in rawToolsResult &&
          Array.isArray(rawToolsResult.tools)
        ) {
          rawToolsResult.tools.forEach((tool: any) => {
            if (tool && typeof tool === "object" && "name" in tool) {
              // Extract required parameters if available
              let requiredParams: string[] = [];

              if (
                tool.inputSchema &&
                typeof tool.inputSchema === "object" &&
                "required" in tool.inputSchema &&
                Array.isArray(tool.inputSchema.required)
              ) {
                requiredParams = tool.inputSchema.required;
              }

              // Enhanced description with parameter requirements if available
              let enhancedDescription = tool.description || "";

              // Add parameter information to the description
              if (requiredParams.length > 0) {
                enhancedDescription += `\nRequired parameters: ${requiredParams.join(
                  ", "
                )}`;
              }

              // Add example structure if we can derive it from schema
              const exampleInput = this.deriveExampleInput(
                tool.inputSchema,
                tool.name
              );
              if (exampleInput) {
                enhancedDescription += `\nExample usage: ${exampleInput}`;
              }

              toolsMap[tool.name] = {
                description: enhancedDescription,
                schema: tool.inputSchema || {},
                execute: async (args: Record<string, unknown>) => {
                  return this.callTool(tool.name, args);
                },
              };
            }
          });
        }
        // If the result is an array directly
        else if (Array.isArray(rawToolsResult)) {
          rawToolsResult.forEach((tool: any) => {
            if (tool && typeof tool === "object" && "name" in tool) {
              // Extract required parameters if available
              let requiredParams: string[] = [];

              if (
                tool.inputSchema &&
                typeof tool.inputSchema === "object" &&
                "required" in tool.inputSchema &&
                Array.isArray(tool.inputSchema.required)
              ) {
                requiredParams = tool.inputSchema.required;
              }

              // Enhanced description with parameter requirements if available
              let enhancedDescription = tool.description || "";

              // Add parameter information to the description
              if (requiredParams.length > 0) {
                enhancedDescription += `\nRequired parameters: ${requiredParams.join(
                  ", "
                )}`;
              }

              // Add example structure if we can derive it from schema
              const exampleInput = this.deriveExampleInput(
                tool.inputSchema,
                tool.name
              );
              if (exampleInput) {
                enhancedDescription += `\nExample usage: ${exampleInput}`;
              }

              toolsMap[tool.name] = {
                description: enhancedDescription,
                schema: tool.inputSchema || {},
                execute: async (args: Record<string, unknown>) => {
                  return this.callTool(tool.name, args);
                },
              };
            }
          });
        }
      }

      // Cache the result
      this.toolsCache = toolsMap;

      return toolsMap;
    } catch (error) {
      console.error("Error fetching tools:", error);
      // Return empty map on error rather than throwing
      return {};
    }
  }

  /**
   * Close the connection to the MCP server
   * This method matches the expected CopilotKit interface
   */
  public async close(): Promise<void> {
    return this.disconnect();
  }

  /**
   * Disconnects from the MCP server
   * (Legacy method, prefer using close() for compatibility with CopilotKit)
   */
  public async disconnect(): Promise<void> {
    try {
      // Clear the tools cache
      this.toolsCache = null;

      // Close the transport connection
      await this.transport.close();
      this.isConnected = false;
      console.log("Disconnected from MCP server");
    } catch (error) {
      console.error("Error disconnecting from MCP server:", error);
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Call a tool with the given name and arguments
   * @param name Tool name
   * @param args Tool arguments
   * @returns Tool execution result
   */
  public async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<any> {
    try {
      console.log(
        `Calling tool: ${name} with args:`,
        JSON.stringify(args, null, 2)
      );

      // Generic handler for double-nested params structure
      const fixedArgs = this.normalizeToolArgs(args);

      // Process string-encoded JSON objects
      const processedArgs = this.processStringifiedJsonArgs(fixedArgs);

      // Log the processed arguments
      console.log(
        `Processed args for ${name}:`,
        JSON.stringify(processedArgs, null, 2)
      );

      // Call the tool with processed arguments
      return this.client.callTool({
        name: name,
        arguments: processedArgs,
      });
    } catch (error) {
      console.error(`Error calling tool ${name}:`, error);
      throw error;
    }
  }

  /**
   * Normalize tool arguments - detects and fixes common patterns in LLM tool calls
   * like double-nested params objects
   */
  private normalizeToolArgs(
    args: Record<string, unknown>
  ): Record<string, unknown> {
    // Handle double-nested params: { params: { params: { actual data } } }
    if (
      "params" in args &&
      args.params !== null &&
      typeof args.params === "object"
    ) {
      const paramsObj = args.params as Record<string, unknown>;
      if ("params" in paramsObj) {
        console.log("Detected double-nested params, fixing structure");
        return paramsObj;
      }
    }

    return args;
  }

  /**
   * Process arguments to handle cases where JSON strings might be passed instead of objects
   */
  private processStringifiedJsonArgs(
    args: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Process each argument to handle potential JSON strings
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string") {
        // Try to parse potential JSON strings
        try {
          const parsedValue = JSON.parse(value);
          result[key] = parsedValue;
        } catch (e) {
          // Not valid JSON, keep as string
          result[key] = value;
        }
      } else if (Array.isArray(value)) {
        // Preserve arrays properly
        result[key] = value.map((item) =>
          typeof item === "object" && item !== null
            ? this.processStringifiedJsonArgs(item as Record<string, unknown>)
            : item
        );
      } else if (value !== null && typeof value === "object") {
        // Recursively process nested objects
        result[key] = this.processStringifiedJsonArgs(
          value as Record<string, unknown>
        );
      } else {
        // Keep other types as-is
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Derives an example input structure from a tool's inputSchema
   * This helps the LLM understand how to format requests properly
   */
  private deriveExampleInput(
    inputSchema: any,
    toolName: string
  ): string | null {
    if (!inputSchema) return null;

    try {
      // Handle special cases for better guidance
      if (toolName.toLowerCase().includes("asana_create")) {
        return '{ "params": { "data": { "name": "Task name", "notes": "Task description" } } }';
      }

      if (inputSchema.type === "object" && inputSchema.properties) {
        // Build a minimal example object
        const example: Record<string, any> = {};
        const props = inputSchema.properties;

        // Add required properties first
        if (Array.isArray(inputSchema.required)) {
          inputSchema.required.forEach((key: string) => {
            if (key in props) {
              if (props[key].type === "object" && props[key].properties) {
                example[key] = this.createExampleObject(props[key]);
              } else if (props[key].type === "string") {
                example[key] = `"Example ${key}"`;
              } else if (props[key].type === "number") {
                example[key] = 123;
              } else if (props[key].type === "boolean") {
                example[key] = true;
              } else {
                example[key] = null;
              }
            }
          });
        }

        return JSON.stringify(example, null, 2);
      }

      return null;
    } catch (error) {
      console.error("Error creating example input:", error);
      return null;
    }
  }

  /**
   * Creates an example object from an object schema
   */
  private createExampleObject(schema: any): Record<string, any> {
    const result: Record<string, any> = {};

    if (schema.type !== "object" || !schema.properties) {
      return result;
    }

    const props = schema.properties;

    // Add required properties
    if (Array.isArray(schema.required)) {
      schema.required.forEach((key: string) => {
        if (key in props) {
          if (props[key].type === "object" && props[key].properties) {
            result[key] = this.createExampleObject(props[key]);
          } else if (props[key].type === "string") {
            result[key] = `Example ${key}`;
          } else if (props[key].type === "number") {
            result[key] = 123;
          } else if (props[key].type === "boolean") {
            result[key] = true;
          } else {
            result[key] = null;
          }
        }
      });
    }

    return result;
  }
}
