/**
 * Starts the official Notion MCP server as a Streamable-HTTP sidecar for
 * the triage agent (see `runtime.ts`). Run with `pnpm notion-mcp`.
 *
 * Why a launcher instead of a raw npm script: the Notion server takes its
 * Notion integration secret via the `NOTION_TOKEN` env var and its HTTP
 * transport bearer via `AUTH_TOKEN` (or `--auth-token`). We keep the
 * example's env in a single `.env` (`NOTION_TOKEN` + `NOTION_MCP_AUTH_TOKEN`)
 * and map it here, so this works identically on Windows/macOS/Linux without
 * shell-specific env interpolation.
 */
import "dotenv/config";
import { spawn } from "node:child_process";

const authToken = process.env["NOTION_MCP_AUTH_TOKEN"];
const notionToken = process.env["NOTION_TOKEN"];

if (!authToken) {
  console.error(
    "[notion-mcp] NOTION_MCP_AUTH_TOKEN is required — it's the bearer the " +
      "agent uses to reach this sidecar. Set it in .env (any strong string).",
  );
  process.exit(1);
}
if (!notionToken) {
  console.error(
    "[notion-mcp] NOTION_TOKEN is required — the Notion integration secret " +
      "(ntn_...). Create one at notion.so → Settings → Connections.",
  );
  process.exit(1);
}

// Port the sidecar listens on. Must agree with NOTION_MCP_URL in runtime.ts
// (default http://127.0.0.1:3001/mcp).
const port = process.env["NOTION_MCP_PORT"] ?? "3001";

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "-y",
    "@notionhq/notion-mcp-server",
    "--transport",
    "http",
    "--port",
    port,
    "--auth-token",
    authToken,
  ],
  {
    stdio: "inherit",
    env: { ...process.env, NOTION_TOKEN: notionToken, AUTH_TOKEN: authToken },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
