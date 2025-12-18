import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolResult,
  isInitializeRequest,
  ReadResourceResult,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import cors from "cors";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Define the resource URI meta key inline (from MCP Apps Extension protocol)
const RESOURCE_URI_META_KEY = "ui/resourceUri";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load UI HTML file from dist/
const distDir = path.join(__dirname, "dist");
const loadHtml = async (name: string) => {
  const htmlPath = path.join(distDir, `${name}.html`);
  return fs.readFile(htmlPath, "utf-8");
};

// Create an MCP server with UI tools
const getServer = async () => {
  const server = new McpServer(
    {
      name: "mcp-apps-demo-server",
      version: "1.0.0",
    },
    { capabilities: { logging: {} } },
  );

  // Load HTML for the raw UI
  const rawHtml = await loadHtml("ui-raw");

  const registerResource = (resource: Resource, htmlContent: string) => {
    server.registerResource(
      resource.name,
      resource.uri,
      resource,
      async (): Promise<ReadResourceResult> => ({
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: htmlContent,
          },
        ],
      }),
    );
    return resource;
  };

  // Register the raw UI resource and tool
  {
    const rawResource = registerResource(
      {
        name: "ui-raw-template",
        uri: "ui://raw",
        title: "Raw UI Template",
        description: "A simple raw HTML UI",
        mimeType: "text/html+mcp",
      },
      rawHtml,
    );

    server.registerTool(
      "create-ui-raw",
      {
        title: "Raw UI",
        description: "A tool that returns a raw HTML UI (no Apps SDK runtime)",
        inputSchema: {
          message: z.string().describe("Message to display"),
        },
        _meta: {
          [RESOURCE_URI_META_KEY]: rawResource.uri,
        },
      },
      async ({ message }): Promise<CallToolResult> => ({
        content: [{ type: "text", text: JSON.stringify({ message }) }],
        structuredContent: { message },
      }),
    );
  }

  // Register the get-weather tool (no UI resource, for testing from within UI)
  server.registerTool(
    "get-weather",
    {
      title: "Get Weather",
      description: "Returns current weather for a location",
      inputSchema: {
        location: z.string().describe("Location to get weather for"),
      },
    },
    async ({ location }): Promise<CallToolResult> => {
      const temperature = 25;
      const condition = "sunny";
      return {
        content: [
          {
            type: "text",
            text: `The weather in ${location} is ${condition}, ${temperature}°C.`,
          },
        ],
        structuredContent: { temperature, condition },
      };
    },
  );

  return server;
};

const MCP_PORT = process.env.MCP_PORT
  ? parseInt(process.env.MCP_PORT, 10)
  : 3001;

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
  }),
);

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

const mcpPostHandler = async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;
    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const eventStore = new InMemoryEventStore();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (sessionId) => {
          console.log(`Session initialized: ${sessionId}`);
          transports[sessionId] = transport;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Session closed: ${sid}`);
          delete transports[sid];
        }
      };

      const server = await getServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
};

app.post("/mcp", mcpPostHandler);

app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling session termination:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing session termination");
    }
  }
});

app.listen(MCP_PORT, () => {
  console.log(`MCP Server listening on http://localhost:${MCP_PORT}/mcp`);
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  for (const sessionId in transports) {
    try {
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
    }
  }
  process.exit(0);
});
