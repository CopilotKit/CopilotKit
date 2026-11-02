import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyThread, verifyLearning } from "./proof.mjs";
import { scenario } from "./model.mjs";

/** Exercise the built SDK in a separate process so its long-lived sockets are scoped. */
async function exercise() {
  const input = JSON.parse(await readFile(process.argv[2], "utf8"));
  const runtimeDist = join(
    input.consumer,
    "node_modules/@copilotkit/runtime/dist",
  );
  const {
    CopilotRuntime,
    CopilotKitIntelligence,
    createCopilotRuntimeHandler,
  } = await import(pathToFileURL(join(runtimeDist, "index.mjs")));
  const { tanstackAIAgent } = await import(
    pathToFileURL(join(runtimeDist, "tanstack-ai.mjs"))
  );
  const { openaiCompatibleText } = await import(
    pathToFileURL(
      join(
        input.consumer,
        "node_modules/@tanstack/ai-openai/dist/esm/compatible/index.js",
      ),
    )
  );
  const modelOrigin = new URL(input.modelUrl).origin;
  const createAdapter = () =>
    openaiCompatibleText("smoke-agent", {
      baseURL: `${input.modelUrl}/v1`,
      apiKey: "smoke-placeholder",
      api: "chat-completions",
      fetch: (resource, init) => {
        if (new URL(String(resource)).origin !== modelOrigin)
          throw new Error("External model requests are forbidden");
        return fetch(resource, {
          ...init,
          signal: AbortSignal.timeout(30_000),
        });
      },
    });
  const intelligence = new CopilotKitIntelligence({
    apiUrl: input.apiUrl,
    wsUrl: input.gatewayUrl,
    apiKey: input.apiKey,
    enableEnterpriseLearning: false,
  });
  const runtime = new CopilotRuntime({
    intelligence,
    agents: {
      smoke: tanstackAIAgent({ adapter: createAdapter, maxIterations: 1 }),
    },
    identifyUser: () => ({ id: "smoke-user", name: "Smoke user" }),
    generateThreadNames: false,
  });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
  });
  const request = async (method, path, body) => {
    const headers = { "content-type": "application/json" };
    let response;
    if (path.startsWith("/agent/")) {
      response = await handler(
        new Request(`http://127.0.0.1/api/copilotkit${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        }),
      );
    } else {
      if (path.startsWith("/api/learning/"))
        headers["x-copilotkit-ei-service-token"] = input.serviceToken;
      else headers.authorization = `Bearer ${input.apiKey}`;
      response = await fetch(`${input.apiUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    }
    if (!response.ok)
      throw new Error(
        `${method} ${path}: HTTP ${response.status}: ${await response.text()}`,
      );
    return response.json();
  };
  const thread = await verifyThread({
    request,
    ...scenario,
    expectedReply: input.expectedReply ?? scenario.reply,
  });
  await writeFile(input.result, JSON.stringify({ thread }, null, 2));
  const learning = await verifyLearning({
    request,
    projectId: input.projectId,
    threadId: thread.threadId,
    runId: thread.runId,
    messageIds: thread.messageIds,
    containerId: "local-proof-smoke",
  });
  await writeFile(
    input.result,
    JSON.stringify({ runtimeEntry: entry, thread, learning }, null, 2),
  );
}

try {
  await exercise();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
