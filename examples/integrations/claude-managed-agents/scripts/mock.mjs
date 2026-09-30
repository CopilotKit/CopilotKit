#!/usr/bin/env node
// `npm run dev:mock`: the same UI against an aimock AG-UI replay server.
// No Anthropic requests, no tokens. Useful for showcase pages, UI work and CI.
//
// aimock cannot stand in for Managed Agents itself (the harness runs on
// Anthropic's side, there is no base URL to redirect), so we mock one layer
// up: the AG-UI event stream that ManagedAgentsAgent would have produced.
//
// `npm run mock:record` instead proxies to a running real app and saves what
// it streams under mock/recordings/, as a starting point for new fixtures.

import { spawn } from "node:child_process";
import { AGUIMock, buildAGUICompositeResponse } from "@copilotkit/aimock";
import { fallback, followup } from "../mock/fixtures.mjs";

const mode = process.argv[2] ?? "dev";
const port = Number(process.env.AIMOCK_PORT ?? 4010);
const agui = new AGUIMock({ port, host: "127.0.0.1" });

if (mode === "record") {
  const upstream =
    process.env.AGUI_UPSTREAM ??
    "http://localhost:3000/api/copilotkit/agent/default/run";
  agui.enableRecording({
    upstream,
    fixturePath: "mock/recordings",
    proxyOnly: false,
  });
} else {
  agui.onPredicate(
    (input) =>
      (input.messages ?? []).filter((message) => message.role === "user")
        .length > 1,
    buildAGUICompositeResponse([followup]),
    50,
  );
  agui.onPredicate(() => true, buildAGUICompositeResponse([fallback]), 50);
}

const url = await agui.start();
console.log(
  `aimock AG-UI ${mode === "record" ? "recorder" : "replay"} listening at ${url}`,
);

const pm = process.env.npm_execpath?.includes("pnpm")
  ? "pnpm"
  : process.env.npm_execpath?.includes("yarn")
    ? "yarn"
    : process.env.npm_execpath?.includes("bun")
      ? "bun"
      : "npm";
const env = { ...process.env, AGENT_URL: url };
if (mode === "record") env.PORT = process.env.PORT ?? "3001";
const child = spawn(pm, ["run", "dev"], { stdio: "inherit", env });
const stop = () => {
  child.kill("SIGINT");
  void agui.stop().finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on(
  "exit",
  (code) => void agui.stop().finally(() => process.exit(code ?? 0)),
);
