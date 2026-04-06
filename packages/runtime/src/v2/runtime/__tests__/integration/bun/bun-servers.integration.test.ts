/**
 * Integration tests for Bun-based server runtimes.
 *
 * Run with: bun test packages/runtime/src/v2/runtime/__tests__/integration/bun/
 *
 * Tests:
 *   - Elysia (multi + single)
 *   - Hono via Bun.serve (multi + single)
 */

import { multiEndpointSuite } from "../suites/multi-endpoint.suite";
import { singleEndpointSuite } from "../suites/single-endpoint.suite";

import { createElysiaMultiServer } from "./elysia-multi";
import { createElysiaSingleServer } from "./elysia-single";
import { createHonoBunMultiServer } from "./hono-bun-multi";
import { createHonoBunSingleServer } from "./hono-bun-single";

// ─── Multi-Endpoint ──────────────────────────────────────────────────

multiEndpointSuite("Elysia", createElysiaMultiServer);
multiEndpointSuite("Hono (Bun)", createHonoBunMultiServer);

// ─── Single-Endpoint ─────────────────────────────────────────────────

singleEndpointSuite("Elysia", createElysiaSingleServer);
singleEndpointSuite("Hono (Bun)", createHonoBunSingleServer);
