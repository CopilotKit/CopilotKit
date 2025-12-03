import { MCPTool, MCPClient as MCPClientInterface, MCPEndpointConfig } from "./mcp-tools-utils";

// Dynamic EventSource import for Node.js environments
let EventSourceImpl: typeof EventSource | undefined;
let isNodeEnvironment = false;

// Initialize EventSource implementation
async function initializeEventSource(): Promise<void> {
  if (typeof EventSource !== "undefined") {
    // Browser environment - use native EventSource
    EventSourceImpl = EventSource;
    isNodeEnvironment = false;
  } else {
    // Node.js environment - use dynamic import
    try {
      // @ts-ignore - eventsource is an optional dependency
      const eventsourceModule = await import("eventsource");
      EventSourceImpl = eventsourceModule.default || eventsourceModule;
      isNodeEnvironment = true;
    } catch (e) {
      // EventSource polyfill not available, will throw error when needed
      EventSourceImpl = undefined;
      isNodeEnvironment = false;
    }
  }
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
  private rpcUrl: string;
  private streamUrl: string;
  private sessionId: string | null = null;
  private eventSource: EventSource | null = null;
  private headers: Record<string, string>;
  private toolsCache: Record<string, MCPTool> | null = null;
  
  // Connection state management
  private isConnecting: boolean = false;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  
  // Reconnection strategy properties
  private reconnectAttempt: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly maxRetries: number = 5;
  private readonly baseDelay: number = 1000; // 1 second
  private readonly maxDelay: number = 30000; // 30 seconds

  constructor(config: MCPEndpointConfig) {
    try {
      // Split the endpoint into RPC and SSE URLs
      const endpoint = new URL(config.endpoint);
      if (/\/sse\/?$/.test(endpoint.pathname)) {
        // If endpoint ends with /sse or /sse/, use it for SSE and derive RPC URL
        this.streamUrl = endpoint.toString();
        endpoint.pathname = endpoint.pathname.replace(/\/sse\/?$/, "/");
        this.rpcUrl = endpoint.toString();
      } else {
        // If endpoint doesn't end with /sse, use it for RPC and derive SSE URL
        this.rpcUrl = endpoint.toString();
        const streamEndpoint = new URL(endpoint.toString());
        if (!streamEndpoint.pathname.endsWith("/")) {
          streamEndpoint.pathname += "/";
        }
        streamEndpoint.pathname += "sse";
        this.streamUrl = streamEndpoint.toString();
      }
    } catch (error) {
      throw new Error(`Invalid MCP endpoint URL: ${config.endpoint}. ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    this.headers = config.apiKey 
      ? { Authorization: `Bearer ${config.apiKey}` }
      : {};
  }

  async connect(): Promise<void> {
    // Prevent multiple concurrent connection attempts
    if (this.isConnecting && this.connectionPromise) {
      return this.connectionPromise;
    }
    
    if (this.isConnected) {
      return;
    }
    
    this.isConnecting = true;
    this.connectionPromise = this.performConnection();
    
    try {
      await this.connectionPromise;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }
  
  private async performConnection(): Promise<void> {
    // Use the proven HttpStreamClient approach from the registry
    // This handles both HTTP Stream and hybrid SSE/HTTP servers correctly
    const initRequest = {
      jsonrpc: "2.0",
      id: "init-" + Date.now(),
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "copilotkit-default-client",
          version: "1.0.0",
        },
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(this.rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...this.headers,
        },
        body: JSON.stringify(initRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

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
          try {
            responseData = JSON.parse(dataLine.substring(5).trim());
          } catch (parseError) {
            throw new Error(`Failed to parse SSE response data: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
          }
        } else {
          throw new Error("No data line found in SSE response");
        }
      } else {
        try {
          responseData = await response.json();
        } catch (parseError) {
          throw new Error(`Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
        }
      }

      // Validate response structure
      if (!responseData || typeof responseData !== 'object') {
        throw new Error("Invalid response data structure");
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
      
      // Session ID is optional - some MCP servers don't use sessions
      // Only open SSE stream if we have a session ID
      if (this.sessionId) {
        await this.openEventStream();
      } else {
        console.log("MCP server does not use sessions - proceeding without SSE stream");
      }
      
      this.isConnected = true;
      console.log(`Connected to MCP server with session: ${this.sessionId}`);
      
    } catch (error) {
      clearTimeout(timeoutId);
      this.isConnected = false;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error("Connection timeout after 30 seconds");
      }
      throw error;
    }
  }

  private async openEventStream(): Promise<void> {
    if (!this.sessionId) return;

    // Initialize EventSource implementation if not already done
    if (!EventSourceImpl) {
      await initializeEventSource();
    }

    // Clean up existing EventSource connection to prevent leaks
    if (this.eventSource) {
      this.eventSource.onmessage = null;
      this.eventSource.onerror = null;
      this.eventSource.onopen = null;
      this.eventSource.close();
      this.eventSource = null;
    }

    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const url = new URL(this.streamUrl);
    url.searchParams.set("session", this.sessionId);
    
    // Prepare EventSource options - only include headers in Node.js environment
    const eventSourceOptions: any = {};
    if (isNodeEnvironment && Object.keys(this.headers).length > 0) {
      // Include all headers for Node.js polyfill (including auth and session headers)
      eventSourceOptions.headers = {
        ...this.headers,
        "Mcp-Session-Id": this.sessionId,
      };
    }
    
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
      this.handleReconnection();
    };

    this.eventSource.onopen = () => {
      console.log("SSE connection opened");
      // Reset reconnection attempt counter on successful connection
      this.reconnectAttempt = 0;
    };
  }

  private handleReconnection(): void {
    // Check if we should stop retrying
    if (this.reconnectAttempt >= this.maxRetries) {
      console.error(`Max reconnection attempts (${this.maxRetries}) reached. Giving up.`);
      return;
    }

    // Check if session still exists
    if (!this.sessionId) {
      console.error("No session ID available for reconnection.");
      return;
    }

    // Prevent multiple concurrent reconnect attempts
    if (this.reconnectTimer) {
      return;
    }

    // Calculate exponential backoff delay with jitter
    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.reconnectAttempt),
      this.maxDelay
    );
    const jitter = Math.random() * 0.1 * delay; // 10% jitter
    const finalDelay = delay + jitter;

    this.reconnectAttempt++;
    
    console.log(`Attempting reconnection ${this.reconnectAttempt}/${this.maxRetries} in ${Math.round(finalDelay)}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.sessionId) {
        this.openEventStream().catch((error) => {
          console.error("Error during MCP reconnection:", error);
        });
      }
    }, finalDelay);
  }

  async tools(): Promise<Record<string, MCPTool>> {
    if (this.toolsCache) {
      return this.toolsCache;
    }

    // Ensure we're connected before making requests
    if (!this.isConnected) {
      throw new Error("MCP client is not connected. Call connect() first.");
    }

    const request = {
      jsonrpc: "2.0",
      id: "tools-" + Date.now(),
      method: "tools/list",
      params: {},
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    try {
      const response = await fetch(this.rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
          ...this.headers,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

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
          try {
            result = JSON.parse(dataLine.substring(5).trim());
          } catch (parseError) {
            throw new Error(`Failed to parse SSE tools response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
          }
        } else {
          throw new Error("No data line found in tools SSE response");
        }
      } else {
        try {
          result = await response.json();
        } catch (parseError) {
          throw new Error(`Failed to parse tools JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
        }
      }

      // Validate response structure
      if (!result || typeof result !== 'object') {
        throw new Error("Invalid tools response structure");
      }

      const toolsMap: Record<string, MCPTool> = {};

      if (result.result?.tools && Array.isArray(result.result.tools)) {
        for (const tool of result.result.tools) {
          if (tool.name && typeof tool.name === 'string') {
            toolsMap[tool.name] = {
              description: tool.description || "",
              schema: {
                parameters: {
                  jsonSchema: tool.inputSchema || {}
                }
              },
              execute: async (args: any) => this.callTool(tool.name, args),
            };
          }
        }
      }

      this.toolsCache = toolsMap;
      return toolsMap;
      
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error("Tools request timeout after 15 seconds");
      }
      throw error;
    }
  }

  private async callTool(name: string, args: any): Promise<any> {
    // Ensure we're connected before making requests
    if (!this.isConnected) {
      throw new Error("MCP client is not connected. Call connect() first.");
    }

    const request = {
      jsonrpc: "2.0",
      id: `tool-${name}-${Date.now()}`,
      method: "tools/call",
      params: {
        name: name,
        arguments: args,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(this.rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
          ...this.headers,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

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
          try {
            result = JSON.parse(dataLine.substring(5).trim());
          } catch (parseError) {
            throw new Error(`Failed to parse SSE tool call response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
          }
        } else {
          throw new Error("No data line found in tool call SSE response");
        }
      } else {
        try {
          result = await response.json();
        } catch (parseError) {
          throw new Error(`Failed to parse tool call JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
        }
      }

      // Validate response structure
      if (!result || typeof result !== 'object') {
        throw new Error("Invalid tool call response structure");
      }

      return result.result;
      
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Tool call timeout after 30 seconds: ${name}`);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.onmessage = null;
      this.eventSource.onerror = null;
      this.eventSource.onopen = null;
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.sessionId) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        await fetch(this.rpcUrl, {
          method: "DELETE",
          headers: {
            ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
            ...this.headers,
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
      } catch (error) {
        console.warn("Error closing MCP session:", error);
      }
      this.sessionId = null;
    }

    // Reset connection state
    this.isConnected = false;
    this.isConnecting = false;
    this.connectionPromise = null;
    this.toolsCache = null;
    this.reconnectAttempt = 0; // Reset reconnection counter
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