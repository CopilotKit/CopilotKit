/**
 * Deno server entry point — run separately, then vitest tests against it.
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-env --node-modules-dir=auto \
 *     deno-server.ts
 *
 * Starts two servers:
 *   - Multi-endpoint on port 3000
 *   - Single-endpoint on port 4000
 */

import { createDenoMultiServer } from "./deno-multi.ts";
import { createDenoSingleServer } from "./deno-single.ts";

await createDenoMultiServer({ port: 3000 });
console.log("Multi-endpoint server running on http://localhost:3000");

await createDenoSingleServer({ port: 4000 });
console.log("Single-endpoint server running on http://localhost:4000");
