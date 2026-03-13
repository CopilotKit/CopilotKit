import { RunAgentInput, RunAgentInputSchema } from "@ag-ui/client";
import { EventEncoder } from "@ag-ui/encoder";
import { CopilotRuntime } from "../runtime";
import { extractForwardableHeaders } from "./header-utils";

interface ConnectAgentParameters {
  request: Request;
  runtime: CopilotRuntime;
  agentId: string;
}

export async function handleConnectAgent({
  runtime,
  request,
  agentId,
}: ConnectAgentParameters) {
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

    // Parse and validate input BEFORE creating the stream
    // so we can return a proper error response
    let input: RunAgentInput;
    try {
      const requestBody = await request.json();
      input = RunAgentInputSchema.parse(requestBody);
    } catch (error) {
      console.error("Invalid connect request body:", error);
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

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new EventEncoder();
    let streamClosed = false;

    // Process the agent connect in the background
    (async () => {
      const forwardableHeaders = extractForwardableHeaders(request);

      runtime.runner
        .connect({
          threadId: input.threadId,
          headers: forwardableHeaders,
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
