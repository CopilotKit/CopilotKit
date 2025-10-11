import { MCPTool, MCPClient as MCPClientInterface, MCPEndpointConfig } from "./mcp-tools-utils";

// EventSource polyfill for Node.js environments
let EventSourceImpl: typeof EventSource | undefined;
try {
  EventSourceImpl = typeof EventSource !== "undefined" ? EventSource : require("eventsource");
} catch (e) {
  // EventSource polyfill not available, will throw error when needed
  EventSourceImpl = undefined;
}

/**
 * Optimal MCP Client implementation for CopilotKit
 * 
 * This implementation uses the proven HttpStreamClient approach from the registry,
 * which properly handles both HTTP Stream and hybrid SSE/HTTP servers.
 * 
 * This fixes the issue described in:
 * https://github.com/CopilotKit/CopilotKit/issues/2595
 */
export class DefaultMCPClient implements MCPClientInterface {
  private baseUrl: string;
  private sessionId: string | null = null;
  private eventSource: EventSource | null = null;
  private headers: Record<string, string>;
  private toolsCache: Record<string, MCPTool> | null = null;

  constructor(config: MCPEndpointConfig) {
    this.baseUrl = config.endpoint;
    this.headers = config.apiKey 
      ? { Authorization: `Bearer ${config.apiKey}` }
      : {};
  }

  async connect(): Promise<void> {
    // Use the proven HttpStreamClient approach from the registry
    // This handles both HTTP Stream and hybrid SSE/HTTP servers correctly
    const initRequest = {
      jsonrpc: "2.0",
      id: "init-" + Date.now(),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "copilotkit-default-client",
          version: "1.0.0",
        },
      },
    };

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...this.headers,
      },
      body: JSON.stringify(initRequest),
    });

    if (!response.ok) {
      throw new Error(`Failed to initialize MCP connection: ${response.status} ${response.statusText}`);
    }

    // Handle SSE response format (hybrid servers)
    let responseData;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("text/event-stream")) {
      const text = await response.text();
      const lines = text.split("\n");
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (dataLine) {
        responseData = JSON.parse(dataLine.substring(5).trim());
      }
    } else {
      responseData = await response.json();
    }

    // Extract session ID from headers or response body
    const sessionIdFromHeaders =
      response.headers.get("Mcp-Session-Id") ??
      response.headers.get("X-Session-Id");
    const sessionIdFromBody =
      responseData?.result?.session?.id ??
      responseData?.result?.sessionId ??
      responseData?.result?.session?.uri;
    this.sessionId = sessionIdFromHeaders ?? sessionIdFromBody ?? null;
    
    if (!this.sessionId) {
      throw new Error("Failed to determine MCP session id from initialize response.");
    }
    
    // Open SSE stream for server messages if we have a session
    if (this.sessionId) {
      this.openEventStream();
    }
    
    console.log(`Connected to MCP server with session: ${this.sessionId}`);
  }

  private openEventStream(): void {
    if (!this.sessionId) return;

    const url = new URL(this.baseUrl);
    url.searchParams.append("session", this.sessionId);
    
    const eventSourceOptions: any =
      Object.keys(this.headers).length > 0 ? { headers: this.headers } : undefined;
    
    if (!EventSourceImpl) {
      throw new Error("EventSource is not available in this environment.");
    }
    
    this.eventSource = new EventSourceImpl(url.toString(), eventSourceOptions);

    this.eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log("Received server message:", message);
      } catch (e) {
        console.error("Error parsing SSE message:", e);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error("SSE connection error:", error);
      // Attempt to reconnect after a delay
      setTimeout(() => {
        if (this.sessionId) {
          this.openEventStream();
        }
      }, 1000);
    };

    this.eventSource.onopen = () => {
      console.log("SSE connection opened");
    };
  }

  async tools(): Promise<Record<string, MCPTool>> {
    if (this.toolsCache) {
      return this.toolsCache;
    }

    const request = {
      jsonrpc: "2.0",
      id: "tools-" + Date.now(),
      method: "tools/list",
      params: {},
    };

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": this.sessionId!,
        ...this.headers,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Failed to list tools: ${response.status} ${response.statusText}`);
    }

    // Handle SSE response format
    let result;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("text/event-stream")) {
      const text = await response.text();
      const lines = text.split("\n");
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (dataLine) {
        result = JSON.parse(dataLine.substring(5).trim());
      }
    } else {
      result = await response.json();
    }

    const toolsMap: Record<string, MCPTool> = {};

    if (result.result?.tools) {
      for (const tool of result.result.tools) {
        toolsMap[tool.name] = {
          description: tool.description,
          schema: tool.inputSchema,
          execute: async (args: any) => this.callTool(tool.name, args),
        };
      }
    }

    this.toolsCache = toolsMap;
    return toolsMap;
  }

  private async callTool(name: string, args: any): Promise<any> {
    const request = {
      jsonrpc: "2.0",
      id: `tool-${name}-${Date.now()}`,
      method: "tools/call",
      params: {
        name: name,
        arguments: args,
      },
    };

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": this.sessionId!,
        ...this.headers,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Failed to call tool ${name}: ${response.status} ${response.statusText}`);
    }

    // Handle SSE response format
    let result;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("text/event-stream")) {
      const text = await response.text();
      const lines = text.split("\n");
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (dataLine) {
        result = JSON.parse(dataLine.substring(5).trim());
      }
    } else {
      result = await response.json();
    }

    return result.result;
  }

  async close(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.sessionId) {
      try {
        await fetch(this.baseUrl, {
          method: "DELETE",
          headers: {
            "Mcp-Session-Id": this.sessionId,
            ...this.headers,
          },
        });
      } catch (error) {
        console.warn("Error closing MCP session:", error);
      }
      this.sessionId = null;
    }

    this.toolsCache = null;
  }
}

/**
 * Default MCP client factory function
 * This provides a working implementation when users don't provide their own createMCPClient
 */
export async function createDefaultMCPClient(config: MCPEndpointConfig): Promise<MCPClientInterface> {
  const client = new DefaultMCPClient(config);
  await client.connect();
  return client;
}