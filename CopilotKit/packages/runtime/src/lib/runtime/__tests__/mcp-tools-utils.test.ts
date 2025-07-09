import {
  extractParametersFromSchema,
  convertMCPToolsToActions,
  generateMcpToolInstructions,
  MCPTool,
} from "../mcp-tools-utils";

describe("MCP Tools Utils", () => {
  describe("extractParametersFromSchema", () => {
    it("should extract parameters from schema.parameters.properties", () => {
      const tool: MCPTool = {
        description: "Test tool",
        schema: {
          parameters: {
            properties: {
              name: { type: "string", description: "A name parameter" },
              age: { type: "number", description: "An age parameter" },
            },
            required: ["name"],
          },
        },
        execute: async () => ({}),
      };

      const parameters = extractParametersFromSchema(tool);

      expect(parameters).toHaveLength(2);
      expect(parameters[0]).toEqual({
        name: "name",
        type: "string",
        description: "A name parameter",
        required: true,
      });
      expect(parameters[1]).toEqual({
        name: "age",
        type: "number",
        description: "An age parameter",
        required: false,
      });
    });

    it("should extract parameters from schema.parameters.jsonSchema", () => {
      const tool: MCPTool = {
        description: "Test tool",
        schema: {
          parameters: {
            jsonSchema: {
              properties: {
                query: { type: "string", description: "Search query" },
              },
              required: ["query"],
            },
          },
        },
        execute: async () => ({}),
      };

      const parameters = extractParametersFromSchema(tool);

      expect(parameters).toHaveLength(1);
      expect(parameters[0]).toEqual({
        name: "query",
        type: "string",
        description: "Search query",
        required: true,
      });
    });

    it("should return empty array when no properties", () => {
      const tool: MCPTool = {
        description: "Test tool",
        schema: {},
        execute: async () => ({}),
      };

      const parameters = extractParametersFromSchema(tool);

      expect(parameters).toHaveLength(0);
    });
  });

  describe("generateMcpToolInstructions", () => {
    it("should generate instructions with correct parameter schema from schema.parameters.properties", () => {
      const toolsMap: Record<string, MCPTool> = {
        whois_domain: {
          description: "Lookups whois information about the domain",
          schema: {
            parameters: {
              properties: {
                domain: { type: "string", description: "The domain to lookup" },
                timeout: { type: "number", description: "Timeout in seconds" },
              },
              required: ["domain"],
            },
          },
          execute: async () => ({}),
        },
      };

      const instructions = generateMcpToolInstructions(toolsMap);

      expect(instructions).toContain("- whois_domain: Lookups whois information about the domain");
      expect(instructions).toContain("- domain* (string) - The domain to lookup");
      expect(instructions).toContain("- timeout (number) - Timeout in seconds");
      expect(instructions).not.toContain("No parameters required");
    });

    it("should generate instructions with correct parameter schema from schema.parameters.jsonSchema", () => {
      const toolsMap: Record<string, MCPTool> = {
        search_tool: {
          description: "Search for information",
          schema: {
            parameters: {
              jsonSchema: {
                properties: {
                  query: { type: "string", description: "Search query" },
                  limit: { type: "number", description: "Maximum results" },
                },
                required: ["query"],
              },
            },
          },
          execute: async () => ({}),
        },
      };

      const instructions = generateMcpToolInstructions(toolsMap);

      expect(instructions).toContain("- search_tool: Search for information");
      expect(instructions).toContain("- query* (string) - Search query");
      expect(instructions).toContain("- limit (number) - Maximum results");
      expect(instructions).not.toContain("No parameters required");
    });

    it("should fallback to schema.properties for backward compatibility", () => {
      const toolsMap: Record<string, MCPTool> = {
        legacy_tool: {
          description: "Legacy tool with old schema format",
          schema: {
            properties: {
              input: { type: "string", description: "Input parameter" },
            },
            required: ["input"],
          } as any, // Cast to any to simulate old schema format
          execute: async () => ({}),
        },
      };

      const instructions = generateMcpToolInstructions(toolsMap);

      expect(instructions).toContain("- legacy_tool: Legacy tool with old schema format");
      expect(instructions).toContain("- input* (string) - Input parameter");
      expect(instructions).not.toContain("No parameters required");
    });

    it("should show 'No parameters required' when no schema properties", () => {
      const toolsMap: Record<string, MCPTool> = {
        simple_tool: {
          description: "Simple tool with no parameters",
          schema: {},
          execute: async () => ({}),
        },
      };

      const instructions = generateMcpToolInstructions(toolsMap);

      expect(instructions).toContain("- simple_tool: Simple tool with no parameters");
      expect(instructions).toContain("No parameters required");
    });

    it("should handle tools with no schema", () => {
      const toolsMap: Record<string, MCPTool> = {
        no_schema_tool: {
          description: "Tool without schema",
          execute: async () => ({}),
        },
      };

      const instructions = generateMcpToolInstructions(toolsMap);

      expect(instructions).toContain("- no_schema_tool: Tool without schema");
      expect(instructions).toContain("No parameters required");
    });

    it("should return empty string for empty tools map", () => {
      const instructions = generateMcpToolInstructions({});
      expect(instructions).toBe("");
    });
  });

  describe("convertMCPToolsToActions", () => {
    it("should convert MCP tools to CopilotKit actions", () => {
      const mcpTools: Record<string, MCPTool> = {
        test_tool: {
          description: "Test tool",
          schema: {
            parameters: {
              properties: {
                input: { type: "string", description: "Input parameter" },
              },
              required: ["input"],
            },
          },
          execute: async (params) => `Result: ${params.input}`,
        },
      };

      const actions = convertMCPToolsToActions(mcpTools, "http://example.com");

      expect(actions).toHaveLength(1);
      expect(actions[0].name).toBe("test_tool");
      expect(actions[0].description).toBe("Test tool");
      expect(actions[0].parameters).toHaveLength(1);
      expect(actions[0].parameters[0]).toEqual({
        name: "input",
        type: "string",
        description: "Input parameter",
        required: true,
      });
      expect((actions[0] as any)._isMCPTool).toBe(true);
      expect((actions[0] as any)._mcpEndpoint).toBe("http://example.com");
    });

    it("should handle tool execution correctly", async () => {
      const mcpTools: Record<string, MCPTool> = {
        echo_tool: {
          description: "Echo tool",
          schema: {
            parameters: {
              properties: {
                message: { type: "string", description: "Message to echo" },
              },
              required: ["message"],
            },
          },
          execute: async (params) => `Echo: ${params.message}`,
        },
      };

      const actions = convertMCPToolsToActions(mcpTools, "http://example.com");
      const result = await actions[0].handler({ message: "Hello" });

      expect(result).toBe("Echo: Hello");
    });

    it("should stringify non-string results", async () => {
      const mcpTools: Record<string, MCPTool> = {
        json_tool: {
          description: "JSON tool",
          schema: {},
          execute: async () => ({ result: "success", data: [1, 2, 3] }),
        },
      };

      const actions = convertMCPToolsToActions(mcpTools, "http://example.com");
      const result = await actions[0].handler({});

      expect(result).toBe('{"result":"success","data":[1,2,3]}');
    });

    it("should handle execution errors", async () => {
      const mcpTools: Record<string, MCPTool> = {
        error_tool: {
          description: "Error tool",
          schema: {},
          execute: async () => {
            throw new Error("Test error");
          },
        },
      };

      const actions = convertMCPToolsToActions(mcpTools, "http://example.com");

      await expect(actions[0].handler({})).rejects.toThrow(
        "Execution failed for MCP tool 'error_tool': Test error",
      );
    });
  });
});
