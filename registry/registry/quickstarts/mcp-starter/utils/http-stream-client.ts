import { MCPTool, MCPClient as MCPClientInterface } from "@copilotkit/runtime";

/**
 * HTTP Stream Transport client implementation for MCP
 * Based on the MCP specification version 2025-03-26
 *
 * This implementation supports both:
 * - Pure HTTP Stream Transport (JSON responses)
 * - Hybrid SSE/HTTP servers (SSE-formatted responses)
 *
 * Many current MCP servers use a hybrid approach where they accept
 * HTTP POST requests but respond with SSE format. This client handles
 * both response formats automatically.
 */
export class HttpStreamClient implements MCPClientInterface {
  private baseUrl: string;
  private sessionId: string | null = null;
  private eventSource: EventSource | null = null;
  private headers: Record<string, string>;
  private toolsCache: Record<string, MCPTool> | null = null;

  constructor(options: {
    serverUrl: string;
    headers?: Record<string, string>;
  }) {
    this.baseUrl = options.serverUrl;
    this.headers = options.headers || {};
  }

  async connect(): Promise<void> {
    // Initialize connection
    const initRequest = {
      jsonrpc: "2.0",
      id: "init-" + Date.now(),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "cpk-http-client",
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

    // Handle SSE response format
    let responseData;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("text/event-stream")) {
      // Parse SSE response
      const text = await response.text();
      const lines = text.split("\n");
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (dataLine) {
        responseData = JSON.parse(dataLine.substring(5).trim());
      }
    } else {
      responseData = await response.json();
    }

    // Store session ID
    this.sessionId = response.headers.get("Mcp-Session-Id");

    // Open SSE stream for server messages (only if we have a session)
    if (this.sessionId) {
      this.openEventStream();
    }

    console.log(`Connected with session: ${this.sessionId}`);
  }

  private openEventStream() {
    if (!this.sessionId) return;

    const url = new URL(this.baseUrl);
    url.searchParams.append("session", this.sessionId);

    this.eventSource = new EventSource(url.toString());

    this.eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log("Received server message:", message);
      } catch (e) {
        console.error("Error parsing SSE message:", e);
      }
    };

    this.eventSource.onerror = () => {
      console.error("SSE connection error, reconnecting...");
      setTimeout(() => this.openEventStream(), 1000);
    };
  }

  async tools(): Promise<Record<string, MCPTool>> {
    if (this.toolsCache) return this.toolsCache;

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
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify(request),
    });

    // Handle SSE response format
    let result;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("text/event-stream")) {
      // Parse SSE response
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
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify(request),
    });

    // Handle SSE response format
    let result;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("text/event-stream")) {
      // Parse SSE response
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
      await fetch(this.baseUrl, {
        method: "DELETE",
        headers: {
          "Mcp-Session-Id": this.sessionId,
          ...this.headers,
        },
      });
      this.sessionId = null;
    }
  }
}
