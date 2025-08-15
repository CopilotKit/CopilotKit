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

      const result = extractParametersFromSchema(tool);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: "name",
        type: "string",
        description: "A name parameter",
        required: true,
      });
      expect(result[1]).toEqual({
        name: "age",
        type: "number",
        description: "An age parameter",
        required: false,
      });
    });

    it("should extract parameters from schema.parameters.jsonSchema", () => {
      const tool: MCPTool = {
        description: "Test tool with jsonSchema",
        schema: {
          parameters: {
            jsonSchema: {
              properties: {
                title: { type: "string", description: "A title parameter" },
                count: { type: "number", description: "A count parameter" },
              },
              required: ["title"],
            },
          },
        },
        execute: async () => ({}),
      };

      const result = extractParametersFromSchema(tool);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: "title",
        type: "string",
        description: "A title parameter",
        required: true,
      });
      expect(result[1]).toEqual({
        name: "count",
        type: "number",
        description: "A count parameter",
        required: false,
      });
    });

    it("should handle arrays with items", () => {
      const tool: MCPTool = {
        description: "Test tool with array parameters",
        schema: {
          parameters: {
            properties: {
              simpleArray: {
                type: "array",
                items: { type: "string" },
                description: "Array of strings",
              },
              objectArray: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value: { type: "number" },
                  },
                },
                description: "Array of objects",
              },
            },
            required: ["simpleArray"],
          },
        },
        execute: async () => ({}),
      };

      const result = extractParametersFromSchema(tool);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: "simpleArray",
        type: "array<string>",
        description: "Array of strings",
        required: true,
      });
      expect(result[1]).toEqual({
        name: "objectArray",
        type: "array",
        description: "Array of objects Array of objects with properties: name, value",
        required: false,
      });
    });

    it("should handle enums", () => {
      const tool: MCPTool = {
        description: "Test tool with enum parameters",
        schema: {
          parameters: {
            properties: {
              status: {
                type: "string",
                enum: ["active", "inactive", "pending"],
                description: "Status value",
              },
              priority: {
                type: "number",
                enum: [1, 2, 3],
                description: "Priority level",
              },
            },
            required: ["status"],
          },
        },
        execute: async () => ({}),
      };

      const result = extractParametersFromSchema(tool);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: "status",
        type: "string",
        description: "Status value Allowed values: active | inactive | pending",
        required: true,
      });
      expect(result[1]).toEqual({
        name: "priority",
        type: "number",
        description: "Priority level Allowed values: 1 | 2 | 3",
        required: false,
      });
    });

    it("should handle nested objects", () => {
      const tool: MCPTool = {
        description: "Test tool with nested object parameters",
        schema: {
          parameters: {
            properties: {
              user: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  email: { type: "string" },
                  preferences: {
                    type: "object",
                    properties: {
                      theme: { type: "string" },
                      notifications: { type: "boolean" },
                    },
                  },
                },
                description: "User object",
              },
            },
            required: ["user"],
          },
        },
        execute: async () => ({}),
      };

      const result = extractParametersFromSchema(tool);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "user",
        type: "object",
        description: "User object Object with properties: name, email, preferences",
        required: true,
      });
    });

    it("should return empty array when no properties", () => {
      const tool: MCPTool = {
        description: "Test tool without properties",
        schema: {
          parameters: {},
        },
        execute: async () => ({}),
      };

      const result = extractParametersFromSchema(tool);
      expect(result).toHaveLength(0);
    });
  });

  describe("generateMcpToolInstructions", () => {
    it("should generate instructions with correct parameter schema from schema.parameters.properties", () => {
      const toolsMap: Record<string, MCPTool> = {
        testTool: {
          description: "A test tool",
          schema: {
            parameters: {
              properties: {
                name: { type: "string", description: "The name parameter" },
                age: { type: "number", description: "The age parameter" },
              },
              required: ["name"],
            },
          },
          execute: async () => ({}),
        },
      };

      const result = generateMcpToolInstructions(toolsMap);
      expect(result).toContain("testTool: A test tool");
      expect(result).toContain("- name* (string) - The name parameter");
      expect(result).toContain("- age (number) - The age parameter");
    });

    it("should generate instructions with correct parameter schema from schema.parameters.jsonSchema", () => {
      const toolsMap: Record<string, MCPTool> = {
        testTool: {
          description: "A test tool with jsonSchema",
          schema: {
            parameters: {
              jsonSchema: {
                properties: {
                  title: { type: "string", description: "The title parameter" },
                  count: { type: "number", description: "The count parameter" },
                },
                required: ["title"],
              },
            },
          },
          execute: async () => ({}),
        },
      };

      const result = generateMcpToolInstructions(toolsMap);
      expect(result).toContain("testTool: A test tool with jsonSchema");
      expect(result).toContain("- title* (string) - The title parameter");
      expect(result).toContain("- count (number) - The count parameter");
    });

    it("should handle complex schemas with arrays and enums", () => {
      const toolsMap: Record<string, MCPTool> = {
        complexTool: {
          description: "A complex tool",
          schema: {
            parameters: {
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      value: { type: "number" },
                    },
                  },
                  description: "Array of items",
                },
                status: {
                  type: "string",
                  enum: ["active", "inactive"],
                  description: "Status",
                },
              },
              required: ["items"],
            },
          },
          execute: async () => ({}),
        },
      };

      const result = generateMcpToolInstructions(toolsMap);
      expect(result).toContain("complexTool: A complex tool");
      expect(result).toContain(
        "- items* (array<object>) - Array of items Array of objects with properties: name, value",
      );
      expect(result).toContain("- status (string) - Status Allowed values: active | inactive");
    });

    it("should fallback to schema.properties for backward compatibility", () => {
      const toolsMap: Record<string, MCPTool> = {
        backwardCompatTool: {
          description: "A backward compatible tool",
          schema: {
            // Direct properties without nested parameters
            properties: {
              name: { type: "string", description: "The name parameter" },
            },
            required: ["name"],
          } as any,
          execute: async () => ({}),
        },
      };

      const result = generateMcpToolInstructions(toolsMap);
      expect(result).toContain("backwardCompatTool: A backward compatible tool");
      expect(result).toContain("- name* (string) - The name parameter");
    });

    it("should show 'No parameters required' when no schema properties", () => {
      const toolsMap: Record<string, MCPTool> = {
        noParamsTool: {
          description: "A tool with no parameters",
          schema: {
            parameters: {},
          },
          execute: async () => ({}),
        },
      };

      const result = generateMcpToolInstructions(toolsMap);
      expect(result).toContain("noParamsTool: A tool with no parameters");
      expect(result).toContain("No parameters required");
    });

    it("should handle tools with no schema", () => {
      const toolsMap: Record<string, MCPTool> = {
        noSchemaTool: {
          description: "A tool with no schema",
          execute: async () => ({}),
        },
      };

      const result = generateMcpToolInstructions(toolsMap);
      expect(result).toContain("noSchemaTool: A tool with no schema");
      expect(result).toContain("No parameters required");
    });

    it("should return empty string for empty tools map", () => {
      const result = generateMcpToolInstructions({});
      expect(result).toBe("");
    });
  });

  describe("convertMCPToolsToActions", () => {
    it("should convert MCP tools to CopilotKit actions", () => {
      const mcpTools: Record<string, MCPTool> = {
        testTool: {
          description: "A test tool",
          schema: {
            parameters: {
              properties: {
                name: { type: "string", description: "The name parameter" },
                age: { type: "number", description: "The age parameter" },
              },
              required: ["name"],
            },
          },
          execute: async () => "test result",
        },
      };

      const result = convertMCPToolsToActions(mcpTools, "http://test-endpoint");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("testTool");
      expect(result[0].description).toBe("A test tool");
      expect(result[0].parameters).toHaveLength(2);
      expect(result[0].parameters[0]).toEqual({
        name: "name",
        type: "string",
        description: "The name parameter",
        required: true,
      });
      expect(result[0].parameters[1]).toEqual({
        name: "age",
        type: "number",
        description: "The age parameter",
        required: false,
      });
    });

    it("should handle tool execution correctly", async () => {
      const mockExecute = jest.fn().mockResolvedValue("mock result");
      const mcpTools: Record<string, MCPTool> = {
        testTool: {
          description: "A test tool",
          schema: {
            parameters: {
              properties: {
                name: { type: "string", description: "The name parameter" },
              },
              required: ["name"],
            },
          },
          execute: mockExecute,
        },
      };

      const result = convertMCPToolsToActions(mcpTools, "http://test-endpoint");
      const action = result[0];

      const executeResult = await action.handler({ name: "test" });
      expect(executeResult).toBe("mock result");
      expect(mockExecute).toHaveBeenCalledWith({ name: "test" });
    });

    it("should stringify non-string results", async () => {
      const mcpTools: Record<string, MCPTool> = {
        testTool: {
          description: "A test tool",
          schema: {
            parameters: {
              properties: {
                name: { type: "string", description: "The name parameter" },
              },
              required: ["name"],
            },
          },
          execute: async () => ({ result: "complex object" }),
        },
      };

      const result = convertMCPToolsToActions(mcpTools, "http://test-endpoint");
      const action = result[0];

      const executeResult = await action.handler({ name: "test" });
      expect(executeResult).toBe('{"result":"complex object"}');
    });

    it("should handle execution errors", async () => {
      const mcpTools: Record<string, MCPTool> = {
        testTool: {
          description: "A test tool",
          schema: {
            parameters: {
              properties: {
                name: { type: "string", description: "The name parameter" },
              },
              required: ["name"],
            },
          },
          execute: async () => {
            throw new Error("Test error");
          },
        },
      };

      const result = convertMCPToolsToActions(mcpTools, "http://test-endpoint");
      const action = result[0];

      await expect(action.handler({ name: "test" })).rejects.toThrow(
        "Execution failed for MCP tool 'testTool': Test error",
      );
    });
  });
});
