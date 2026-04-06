import { createCopilotRuntimeHandler } from "../../../core/fetch-handler";
import { createTestRuntime } from "../helpers/create-test-runtime";
import type { ServerHandle } from "./types";

const BASE_PATH = "/api/copilotkit";
const SYNTHETIC_ORIGIN = "http://localhost";

/**
 * Creates a "server" that invokes the fetch handler directly — no HTTP server.
 * This tests the core fetch handler in isolation.
 *
 * We monkey-patch `globalThis.fetch` for the duration of the test so that
 * standard `fetch(url)` calls route through the handler. Instead, the returned
 * ServerHandle has a `baseUrl` that test suites can use, and the suites use
 * normal `fetch()` which goes over the network for real servers. For the direct
 * handler, callers should use `fetchDirect` exported alongside the factory.
 */
export function createFetchDirectHandler(
  mode: "multi-route" | "single-route",
  opts: { capturedHeaders?: Record<string, string>[] } = {},
): ServerHandle & { handler: (request: Request) => Promise<Response> } {
  const runtime = createTestRuntime(opts);

  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: BASE_PATH,
    mode,
    cors: true,
  });

  return {
    baseUrl: SYNTHETIC_ORIGIN,
    basePath: BASE_PATH,
    handler,
    close: async () => {
      /* no-op — no server to close */
    },
  };
}
