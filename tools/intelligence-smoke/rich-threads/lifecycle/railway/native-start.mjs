import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { nativeInspectionServer } from "./native-inspection.mjs";
const config = JSON.parse(process.env.RICH_NATIVE_INSPECTION_JSON);
assert.equal(config.root, "/data");
assert.ok(["mastra", "strands-typescript"].includes(config.framework));
const server = nativeInspectionServer(config);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(9191, "::", resolve);
});
const child = spawn(
  process.execPath,
  config.framework === "mastra"
    ? ["--import", "tsx", "/app/rich-threads/application/mastra-backend.mjs"]
    : ["--import", "tsx", "/app/src/agent/server.ts"],
  { stdio: "inherit" },
);
const stop = () => child.kill("SIGTERM");
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
server.once("error", stop);
child.once("error", () => {
  server.close();
  process.exitCode = 1;
});
child.once("exit", (code) => {
  server.close();
  process.exitCode = code ?? 1;
});
