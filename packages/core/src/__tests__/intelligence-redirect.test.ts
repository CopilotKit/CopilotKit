import { createServer } from "node:http";
import type { RequestListener, Server } from "node:http";
import { firstValueFrom } from "rxjs";
import { expect, test } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import { IntelligenceAgent } from "../intelligence-agent";

/** Starts an isolated HTTP endpoint on an OS-assigned loopback port. */
async function listen(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

/** Closes connections as well as the listener so tests leave no sockets. */
async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

for (const transport of ["rest", "single"] as const) {
  for (const mode of ["run", "connect"] as const) {
    test.each([307, 308])(
      `${transport} ${mode} does not forward chat data through a %i redirect`,
      async (status) => {
        const receivedBodies: string[] = [];
        const destination = await listen((request, response) => {
          let body = "";
          request.setEncoding("utf8");
          request.on("data", (chunk: string) => {
            body += chunk;
          });
          request.on("end", () => {
            receivedBodies.push(body);
            response.writeHead(mode === "connect" ? 204 : 409).end();
          });
        });
        const source = await listen((_request, response) => {
          response
            .writeHead(status, { Location: `${destination.url}/other` })
            .end();
        });
        const input: RunAgentInput = {
          threadId: "thread-1",
          runId: "run-1",
          messages: [
            { id: "message-1", role: "user", content: "Private conversation" },
          ],
          tools: [],
          context: [],
          state: {},
          forwardedProps: {},
        };
        const agent = new IntelligenceAgent({
          url: "ws://127.0.0.1/unused",
          runtimeUrl: `${source.url}/api`,
          agentId: "default",
          transport,
          headers: { Authorization: "Bearer test-token" },
          credentials: "include",
        });

        try {
          const result = await firstValueFrom(agent[mode](input), {
            defaultValue: null,
          }).catch((error: unknown) => error);

          expect(receivedBodies).toEqual([]);
          expect(result).toBeInstanceOf(Error);
          expect((result as Error).message).toContain(`${mode} request failed`);
        } finally {
          await close(source.server);
          await close(destination.server);
        }
      },
    );
  }
}
