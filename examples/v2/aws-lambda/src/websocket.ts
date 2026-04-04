/**
 * WebSocket handler for AWS Lambda (API Gateway WebSocket API)
 * Enables real-time communication with CopilotKit agents
 */

import { APIGatewayProxyWebsocketEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

interface WebSocketConnection {
  connectionId: string;
  agentId?: string;
  threadId?: string;
  timestamp: string;
}

// Simple in-memory connection store (use DynamoDB in production)
const connections = new Map<string, WebSocketConnection>();

export const handler = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> => {
  const { requestContext, body } = event;
  const connectionId = requestContext.connectionId;
  const routeKey = requestContext.routeKey;

  console.log(`WebSocket ${routeKey}:`, { connectionId });

  try {
    switch (routeKey) {
      case "$connect":
        return await handleConnect(connectionId);
      
      case "$disconnect":
        return await handleDisconnect(connectionId);
      
      case "$default":
        return await handleMessage(connectionId, body);
      
      default:
        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Unknown route" }),
        };
    }
  } catch (error) {
    console.error("WebSocket Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

async function handleConnect(connectionId: string): Promise<APIGatewayProxyResultV2> {
  connections.set(connectionId, {
    connectionId,
    timestamp: new Date().toISOString(),
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Connected" }),
  };
}

async function handleDisconnect(connectionId: string): Promise<APIGatewayProxyResultV2> {
  connections.delete(connectionId);

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Disconnected" }),
  };
}

async function handleMessage(
  connectionId: string,
  body: string | null
): Promise<APIGatewayProxyResultV2> {
  const connection = connections.get(connectionId);
  
  if (!connection) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Connection not found" }),
    };
  }

  try {
    const data = body ? JSON.parse(body) : {};
    const { action, agentId, threadId, message } = data;

    // Update connection with agent/thread info
    if (agentId) connection.agentId = agentId;
    if (threadId) connection.threadId = threadId;

    switch (action) {
      case "subscribe":
        // Subscribe to agent updates
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            message: "Subscribed",
            agentId: connection.agentId,
            threadId: connection.threadId,
          }),
        };
      
      case "ping":
        return {
          statusCode: 200,
          body: JSON.stringify({ message: "pong", timestamp: new Date().toISOString() }),
        };
      
      default:
        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Message received", action }),
        };
    }
  } catch (error) {
    console.error("Message Handler Error:", error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid message format" }),
    };
  }
}
