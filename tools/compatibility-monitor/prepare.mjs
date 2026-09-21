// Runs on the trusted workflow revision before any candidate checkout or command.
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { validateRequest } from "./request.mjs";
const request = validateRequest(JSON.parse(process.env.COMPATIBILITY_REQUEST));
mkdirSync("compatibility-output", { recursive: true });
writeFileSync("request.json", JSON.stringify(request));
writeFileSync(
  "compatibility-output/result.json",
  JSON.stringify({
    schemaVersion: 1,
    requestId: request.requestId,
    adapterId: request.adapterId,
    track: request.track,
    sourceSha: request.sourceSha,
    harnessSha: process.env.GITHUB_WORKFLOW_SHA,
    experimental: request.experimental,
    forcedResolution: false,
    adapterVersion: request.adapterVersion,
    status: "blocked",
    resolvedDependencies: {},
    cases: [
      {
        contractId: "setup",
        status: "blocked",
        message: "Runner did not complete setup or execution",
      },
    ],
    failureStage: "setup",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  }),
);
for (const [key, value] of Object.entries({
  requestId: request.requestId,
  sourceSha: request.sourceSha,
}))
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
