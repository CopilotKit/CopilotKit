import assert from "node:assert/strict";
export const adapters = {
  "builtin-ts": {
    directory: "runtime",
    name: "@copilotkit/runtime",
    entrypoint: "@copilotkit/runtime/v2",
    packages: ["ai", "zod"],
  },
  "langgraph-ts": {
    directory: "intelligence-langgraph",
    name: "@copilotkit/intelligence-langgraph",
    packages: ["langchain", "@langchain/langgraph", "@langchain/core", "zod"],
  },
  "mastra-ts": {
    directory: "intelligence-mastra",
    name: "@copilotkit/intelligence-mastra",
    packages: ["@mastra/core", "zod"],
  },
  "langgraph-python": {
    directory: "intelligence-langgraph-python",
    name: "copilotkit-intelligence-langgraph",
    packages: ["langchain", "langgraph"],
  },
  "adk-python": {
    directory: "intelligence-adk-python",
    name: "copilotkit-intelligence-adk",
    packages: ["google-adk"],
  },
  "agent-framework-dotnet": {
    directory: "intelligence-agent-framework-dotnet",
    name: "CopilotKit.Intelligence.AgentFramework",
    packages: ["Microsoft.Agents.AI"],
  },
};
export function validateRequest(r) {
  assert.ok(
    r && typeof r === "object" && !Array.isArray(r),
    "Request must be an object",
  );
  const keys = [
    "schemaVersion",
    "requestId",
    "adapterId",
    "track",
    "sourceSha",
    "adapterVersion",
    "dependencies",
    "experimental",
  ];
  assert.ok(
    Object.keys(r).every((k) => keys.includes(k)),
    "Unknown request field",
  );
  assert.equal(r.schemaVersion, 1);
  assert.match(
    r.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.ok(Object.hasOwn(adapters, r.adapterId), "Unknown adapter");
  assert.ok(["source", "published"].includes(r.track), "Unknown track");
  assert.match(r.sourceSha, /^[a-f0-9]{40}$/);
  assert.equal(typeof r.experimental, "boolean");
  const exact = r.adapterId.endsWith("-ts")
    ? /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9][a-zA-Z0-9.-]*)?(?:\+[a-zA-Z0-9.-]+)?$/
    : /^\d+\.\d+(?:\.\d+){0,2}(?:(?:[-.]?[a-zA-Z][a-zA-Z0-9.-]*)|(?:-[a-zA-Z0-9][a-zA-Z0-9.-]*))?(?:\+[a-zA-Z0-9.-]+)?$/;
  if (r.track === "published") assert.match(r.adapterVersion, exact);
  else assert.equal(r.adapterVersion, undefined);
  assert.ok(
    r.dependencies &&
      typeof r.dependencies === "object" &&
      !Array.isArray(r.dependencies),
  );
  assert.deepEqual(
    Object.keys(r.dependencies).sort(),
    [...adapters[r.adapterId].packages].sort(),
    "Supply every watched dependency, and no others",
  );
  for (const version of Object.values(r.dependencies))
    assert.match(
      version,
      exact,
      "Dependency must be an exact registry version",
    );
  return r;
}
export function cleanEnvironment(env = process.env) {
  const output = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SystemRoot",
    "DOTNET_ROOT",
    "DOTNET_ROOT_X64",
  ])
    if (env[key]) output[key] = env[key];
  return {
    ...output,
    CI: "true",
    NX_DAEMON: "false",
    NX_NO_CLOUD: "true",
    NX_TUI: "false",
    COPILOTKIT_TELEMETRY_DISABLED: "true",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_NOLOGO: "1",
    PYTHONNOUSERSITE: "1",
  };
}
export function verifyResolved(request, resolved) {
  for (const [name, version] of Object.entries(request.dependencies))
    assert.equal(
      resolved[name],
      version,
      `Loaded version mismatch for ${name}`,
    );
}
