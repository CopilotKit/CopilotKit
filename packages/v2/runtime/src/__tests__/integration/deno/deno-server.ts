/**
 * Deno server entry point — spawned as a subprocess by vitest.
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-env --sloppy-imports deno-server.ts <multi|single>
 *
 * Prints a JSON line to stdout when ready: { "port": 12345 }
 */

import { createDenoMultiServer } from "./deno-multi.ts";
import { createDenoSingleServer } from "./deno-single.ts";

const mode = Deno.args[0];
if (mode !== "multi" && mode !== "single") {
  console.error("Usage: deno-server.ts <multi|single>");
  Deno.exit(1);
}

const h = mode === "multi"
  ? await createDenoMultiServer()
  : await createDenoSingleServer();

// Signal readiness to the parent process
console.log(JSON.stringify({ port: parseInt(new URL(h.baseUrl).port) }));
