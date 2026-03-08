import {
  AbstractAgent,
  Message,
  RunAgentInput,
  RunAgentInputSchema,
} from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { EventEncoder } from "@ag-ui/encoder";
import { CopilotRuntime } from "../runtime";
import { extractForwardableHeaders } from "./header-utils";
import { IntelligenceAgentRunner } from "../runner/intelligence";

interface RunAgentParameters {
  request: Request;
  runtime: CopilotRuntime;
  agentId: string;
}

function isPlatformNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(" 404:");
}

export async function handleRunAgent({
  runtime,
  request,
  agentId,
}: RunAgentParameters) {
  try {
    const agents = await runtime.agents;

    // Check if the requested agent exists
    if (!agents[agentId]) {
      return new Response(
        JSON.stringify({
          error: "Agent not found",
          message: `Agent '${agentId}' does not exist`,
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const registeredAgent = agents[agentId] as AbstractAgent;
    const agent = registeredAgent.clone() as AbstractAgent;

    // Apply runtime-level A2UI middleware if configured
    if (runtime.a2ui) {
      const { agents: targetAgents, ...a2uiOptions } = runtime.a2ui;
      const shouldApply = !targetAgents || targetAgents.includes(agentId);
      if (
        shouldApply &&
        "use" in agent &&
        typeof (agent as any).use === "function"
      ) {
        (agent as any).use(new A2UIMiddleware(a2uiOptions));
      }
    }

    if (runtime.mcpApps?.servers?.length) {
      // Filter to servers that target this agent or have no agentId restriction
      const mcpServers = runtime.mcpApps.servers
        .filter((s) => !s.agentId || s.agentId === agentId)
        .map(({ agentId: _, ...server }) => server);

      if (
        mcpServers.length > 0 &&
        "use" in agent &&
        typeof (agent as any).use === "function"
      ) {
        (agent as any).use(new MCPAppsMiddleware({ mcpServers }));
      }
    }

    if (agent && "headers" in agent) {
      const forwardableHeaders = extractForwardableHeaders(request);
      agent.headers = {
        ...(agent.headers as Record<string, string>),
        ...forwardableHeaders,
      };
    }

    // Parse and validate input BEFORE creating the stream
    // so we can return a proper error response
    let input: RunAgentInput;
    try {
      const requestBody = await request.json();
      input = RunAgentInputSchema.parse(requestBody);
    } catch (error) {
      console.error("Invalid run request body:", error);
      return new Response(
        JSON.stringify({
          error: "Invalid request body",
          details: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    agent.setMessages(input.messages);
    agent.setState(input.state);
    agent.threadId = input.threadId;

    // For IntelligenceAgentRunner, acquire thread connection credentials and
    // return the join token so the client can connect to the Phoenix channel.
    if (runtime.runner instanceof IntelligenceAgentRunner) {
      if (!runtime.intelligencePlatform) {
        return new Response(
          JSON.stringify({
            error: "Intelligence platform not configured",
            message:
              "IntelligenceAgentRunner requires an intelligencePlatform client",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      try {
        await runtime.intelligencePlatform.getThread({
          threadId: input.threadId,
        });
      } catch (error) {
        if (!isPlatformNotFoundError(error)) {
          return new Response(
            JSON.stringify({
              error: "Thread lookup failed",
              message: error instanceof Error ? error.message : String(error),
            }),
            {
              status: 502,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const userId = request.headers.get("X-User-Id");
        if (!userId) {
          return new Response(
            JSON.stringify({
              error: "Thread not found",
              message:
                "Thread does not exist and X-User-Id header is required to create it",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        try {
          await runtime.intelligencePlatform.createThread({
            threadId: input.threadId,
            userId,
            agentId,
          });
        } catch (createError) {
          return new Response(
            JSON.stringify({
              error: "Failed to initialize thread",
              message:
                createError instanceof Error
                  ? createError.message
                  : String(createError),
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }

      let joinCode: string | undefined;
      let joinToken: string | undefined;
      try {
        const lockResult = await runtime.intelligencePlatform.acquireThreadLock(
          {
            threadId: input.threadId,
            runId: input.runId,
          },
        );
        joinToken = lockResult.joinToken;
        joinCode = lockResult.joinCode;
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: "Thread lock denied",
            message: error instanceof Error ? error.message : String(error),
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (!joinToken) {
        return new Response(
          JSON.stringify({
            error: "Join token not available",
            message: "Intelligence platform did not return a join token",
          }),
          {
            status: 502,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      let persistedInputMessages: Message[] | undefined;
      if (Array.isArray(input.messages)) {
        try {
          const history = await runtime.intelligencePlatform.getThreadMessages({
            threadId: input.threadId,
          });
          const historicMessageIds = new Set(
            history.messages.map((message) => message.id),
          );
          persistedInputMessages = input.messages.filter(
            (message) => !historicMessageIds.has(message.id),
          );
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: "Thread history lookup failed",
              message: error instanceof Error ? error.message : String(error),
            }),
            {
              status: 502,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }

      // Kick off the agent run in the background with the join code.
      runtime.runner
        .run({
          threadId: input.threadId,
          agent,
          input,
          ...(persistedInputMessages !== undefined
            ? { persistedInputMessages }
            : {}),
          ...(joinCode ? { joinCode } : {}),
        })
        .subscribe({
          error: (error) => {
            console.error("Error running agent:", error);
          },
        });

      return new Response(JSON.stringify({ joinToken }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Non-intelligence runner: stream SSE events directly.
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new EventEncoder();
    let streamClosed = false;

    // Process the agent run in the background
    (async () => {
      runtime.runner
        .run({
          threadId: input.threadId,
          agent,
          input,
        })
        .subscribe({
          next: async (event) => {
            if (!request.signal.aborted && !streamClosed) {
              try {
                await writer.write(encoder.encode(event));
              } catch (error) {
                if (error instanceof Error && error.name === "AbortError") {
                  streamClosed = true;
                }
              }
            }
          },
          error: async (error) => {
            console.error("Error running agent:", error);
            if (!streamClosed) {
              try {
                await writer.close();
                streamClosed = true;
              } catch {
                // Stream already closed
              }
            }
          },
          complete: async () => {
            if (!streamClosed) {
              try {
                await writer.close();
                streamClosed = true;
              } catch {
                // Stream already closed
              }
            }
          },
        });
    })().catch((error) => {
      console.error("Error running agent:", error);
      console.error(
        "Error stack:",
        error instanceof Error ? error.stack : "No stack trace",
      );
      console.error("Error details:", {
        name: error instanceof Error ? error.name : "Unknown",
        message: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error ? error.cause : undefined,
      });
      if (!streamClosed) {
        try {
          writer.close();
          streamClosed = true;
        } catch {
          // Stream already closed
        }
      }
    });

    // Return the SSE response
    return new Response(stream.readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error running agent:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace",
    );
    console.error("Error details:", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
    });

    return new Response(
      JSON.stringify({
        error: "Failed to run agent",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
