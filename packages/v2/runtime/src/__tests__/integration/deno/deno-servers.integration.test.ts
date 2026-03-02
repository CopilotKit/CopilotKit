/**
 * Integration tests for Deno server runtime.
 *
 * Run with: deno test --allow-net --allow-read --allow-env packages/v2/runtime/src/__tests__/integration/deno/
 *
 * Tests:
 *   - Deno.serve (multi + single)
 */

import { multiEndpointSuite } from "../suites/multi-endpoint.suite";
import { singleEndpointSuite } from "../suites/single-endpoint.suite";

import { createDenoMultiServer } from "./deno-multi";
import { createDenoSingleServer } from "./deno-single";

// ─── Multi-Endpoint ──────────────────────────────────────────────────

multiEndpointSuite("Deno", createDenoMultiServer);

// ─── Single-Endpoint ─────────────────────────────────────────────────

singleEndpointSuite("Deno", createDenoSingleServer);
