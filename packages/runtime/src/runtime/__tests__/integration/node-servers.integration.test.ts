/**
 * Integration tests for all Node.js-compatible server runtimes.
 *
 * Runs the same multi-endpoint and single-endpoint test suites against:
 *   - Express (multi + single)
 *   - Hono via @hono/node-server (multi + single)
 *   - Raw Node.js http (multi + single)
 *   - Direct fetch handler — no HTTP server (multi + single)
 */

import { multiEndpointSuite } from "./suites/multi-endpoint.suite";
import { singleEndpointSuite } from "./suites/single-endpoint.suite";
import {
  debugEventsSuite,
  debugEventsProductionGuardSuite,
} from "./suites/debug-events.suite";

// Server factories
import { createExpressMultiServer } from "./servers/express-multi";
import { createExpressSingleServer } from "./servers/express-single";
import { createHonoMultiServer } from "./servers/hono-multi";
import { createHonoSingleServer } from "./servers/hono-single";
import { createNodeMultiServer } from "./servers/node-multi";
import { createNodeSingleServer } from "./servers/node-single";
import { createFetchDirectHandler } from "./servers/fetch-direct";

// ─── Multi-Endpoint ──────────────────────────────────────────────────

multiEndpointSuite("Express", createExpressMultiServer);
multiEndpointSuite("Hono", createHonoMultiServer);
multiEndpointSuite("Node", createNodeMultiServer);
multiEndpointSuite("Fetch", (opts) =>
  Promise.resolve(createFetchDirectHandler("multi-route", opts)),
);

// ─── Single-Endpoint ─────────────────────────────────────────────────

singleEndpointSuite("Express", createExpressSingleServer);
singleEndpointSuite("Hono", createHonoSingleServer);
singleEndpointSuite("Node", createNodeSingleServer);
singleEndpointSuite("Fetch", (opts) =>
  Promise.resolve(createFetchDirectHandler("single-route", opts)),
);

// ─── Debug Events ───────────────────────────────────────────────────

debugEventsSuite("Express", createExpressMultiServer);
debugEventsSuite("Hono", createHonoMultiServer);
debugEventsSuite("Node", createNodeMultiServer);
debugEventsSuite("Fetch", (opts) =>
  Promise.resolve(createFetchDirectHandler("multi-route", opts)),
);

debugEventsProductionGuardSuite(
  () => createFetchDirectHandler("multi-route"),
  "http://localhost",
  "/api/copilotkit",
);
