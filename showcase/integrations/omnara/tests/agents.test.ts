import assert from "node:assert/strict";
import { test } from "node:test";

const env = {
  OMNARA_API_KEY: "test-server-only-key",
  OMNARA_ORG_ID: "org_test",
  OMNARA_PROJECT_ID: "proj_test",
};

test("agent configuration fails clearly without requiring a network request", async () => {
  const { createAgents } = await import("../src/lib/agents");
  assert.throws(
    () => createAgents({}),
    /OMNARA_API_KEY.*OMNARA_ORG_ID.*OMNARA_PROJECT_ID/,
  );
});

test("each request gets real adapter instances for the demo agent IDs", async () => {
  const { createAgents } = await import("../src/lib/agents");
  const { OmnaraAgent } = await import("@ag-ui/omnara");
  const first = createAgents(env);
  const second = createAgents(env);
  assert.deepEqual(Object.keys(first).sort(), [
    "agentic_chat",
    "frontend_tools",
    "tool-rendering-default-catchall",
  ]);
  for (const id of Object.keys(first)) {
    assert.ok(first[id] instanceof OmnaraAgent);
    assert.notEqual(first[id], second[id]);
  }
});

test("backend tools reject malformed input before invoking handlers", async () => {
  const { backendTools } = await import("../src/lib/backend-tools");
  const weather = backendTools.find((tool) => tool.name === "get_weather")!;
  await assert.rejects(async () =>
    weather.handler({ city: "Paris" }, { toolCallId: "call_test" }),
  );
  assert.deepEqual(
    await weather.handler({ location: "Paris" }, { toolCallId: "call_test" }),
    {
      city: "Paris",
      temperature: 68,
      humidity: 55,
      wind_speed: 10,
      conditions: "Sunny",
    },
  );
});

test("an unconfigured runtime returns a redacted setup error", async (t) => {
  const keys = [
    "OMNARA_API_KEY",
    "OMNARA_ORG_ID",
    "OMNARA_PROJECT_ID",
  ] as const;
  const original = keys.map((key) => [key, process.env[key]] as const);
  t.after(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const key of keys) delete process.env[key];
  const { GET } = await import("../src/app/api/copilotkit/[[...slug]]/route");
  const response = await GET(
    new Request("http://localhost/api/copilotkit/info"),
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Omnara setup is incomplete/);
});
