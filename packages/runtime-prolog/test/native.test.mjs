import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createServer } from "node:http";
import { startPlatform } from "../../../tools/runtime-conformance/platform.mjs";

/** Start the public SWI host with the same composition-only shared driver. */
async function setup(t, configure = () => {}, overrides = {}) {
  const platform = await startPlatform();
  configure(platform);
  const child = spawn(
    "swipl",
    ["--on-error=status", "-q", "-s", "examples/conformance.pl"],
    {
      env: {
        PATH: process.env.PATH,
        CPK_CONFIG: JSON.stringify({
          apiKey: platform.apiKey,
          apiUrl: platform.url,
          runnerUrl: `${platform.wsUrl}/runner`,
          clientUrl: `${platform.wsUrl}/client`,
          agentUrl: `${platform.url}/agent`,
          telemetryUrl: `${platform.url}/telemetry`,
          telemetrySampleRate: 1,
          ...(typeof overrides === "function"
            ? overrides(platform)
            : overrides),
        }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const closed = once(child, "close");
  let logs = "";
  child.stderr.on("data", (data) => {
    logs = (logs + data).slice(-4000);
  });
  const lines = createInterface({ input: child.stdout });
  t.after(async () => {
    lines.close();
    if (child.exitCode === null && !child.signalCode) {
      child.kill("SIGTERM");
      const kill = setTimeout(() => child.kill("SIGKILL"), 12000);
      await closed;
      clearTimeout(kill);
    }
    await platform.close();
  });
  const [line] = await once(lines, "line", {
    signal: AbortSignal.timeout(10000),
  });
  const { port } = JSON.parse(line);
  const request = async (method, path, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/copilotkit${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : undefined,
    };
  };
  return { platform, child, closed, request, logs: () => logs };
}

/** Fresh complete AG-UI input for each independent run. */
function input() {
  return {
    threadId: randomUUID(),
    runId: randomUUID(),
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
}

/** An agent that leaves its socket open until the runtime cancels it. */
function idle(platform) {
  platform.faults.agentKeepOpen = true;
  platform.faults.agentEvents = [
    { type: "TEXT_MESSAGE_START", messageId: "idle", role: "assistant" },
  ];
}

test(
  "idle runs renew the lock and send Phoenix heartbeats",
  { timeout: 25000 },
  async (t) => {
    const { platform, request } = await setup(t, idle);
    const body = input();
    assert.equal(
      (await request("POST", "/agent/default/run", body)).status,
      200,
    );
    await delay(16000);
    assert.ok(platform.frames.some((frame) => frame.name === "heartbeat"));
    assert.ok(platform.locks.get(body.threadId)?.renewals >= 1);
    assert.equal(
      platform.events.some((event) =>
        ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
      ),
      false,
    );
  },
);

test(
  "SIGTERM closes the agent and releases its lock before process exit",
  { timeout: 15000 },
  async (t) => {
    const { platform, child, closed, request, logs } = await setup(t, idle);
    const body = input();
    assert.equal(
      (await request("POST", "/agent/default/run", body)).status,
      200,
    );
    await platform.waitFor(() => platform.agentInputs.length === 1);
    child.kill("SIGTERM");
    const [code, signal] = await closed;
    assert.equal(code, 0, logs());
    assert.equal(signal, null);
    assert.equal(platform.locks.size, 0);
    assert.ok(
      platform.events.some(
        (event) => event.type === "RUN_ERROR" && event.code === "STOPPED",
      ),
    );
  },
);

test(
  "repeated stop requests produce one terminal event",
  { timeout: 10000 },
  async (t) => {
    const { platform, request } = await setup(t, idle);
    const body = input();
    assert.equal(
      (await request("POST", "/agent/default/run", body)).status,
      200,
    );
    await platform.waitFor(() => platform.agentInputs.length === 1);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request("POST", `/agent/default/stop/${body.threadId}`, {
          runId: body.runId,
        }),
      ),
    );
    assert.equal(results.filter((result) => result.body.stopped).length, 1);
    await platform.waitFor(() => platform.locks.size === 0);
    assert.equal(
      platform.events.filter((event) =>
        ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
      ).length,
      1,
    );
  },
);

test("Inspector metadata uses project authentication and private caching", async (t) => {
  const { platform, request } = await setup(t);
  platform.faults.http.set("GET /api/inspector/metadata", {
    status: 200,
    body: {
      schemaVersion: 1,
      identity: {
        organizationName: " Org ",
        projectName: "Project",
        secret: "private",
      },
      rawKey: "private",
    },
  });
  const response = await request("GET", "/inspector-metadata", undefined, {
    authorization: "Bearer browser-value",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  assert.deepEqual(response.body, {
    schemaVersion: 1,
    identity: { organizationName: "Org", projectName: "Project" },
  });
  const upstream = platform.requests.find(
    (entry) => entry.path === "/api/inspector/metadata",
  );
  assert.equal(upstream.headers.authorization, `Bearer ${platform.apiKey}`);
  const wrongMethod = await request("POST", "/inspector-metadata", {});
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET");
  platform.faults.http.set("GET /api/inspector/metadata", {
    status: 503,
    body: { secret: "private" },
  });
  const unavailable = await request("GET", "/inspector-metadata");
  assert.equal(unavailable.status, 204);
  assert.equal(unavailable.body, undefined);
});

test("UTF-8 agent text and trusted input survive native HTTP and Phoenix", async (t) => {
  const text = "你好 café 😀";
  const { platform, request } = await setup(t, (p) => {
    p.faults.agentEvents = [
      { type: "TEXT_MESSAGE_START", messageId: "unicode", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "unicode", delta: text },
      { type: "TEXT_MESSAGE_END", messageId: "unicode" },
      { type: "RUN_FINISHED" },
    ];
  });
  const body = input();
  body.messages = [{ id: "user-message", role: "user", content: text }];
  assert.equal((await request("POST", "/agent/default/run", body)).status, 200);
  await platform.waitFor(() =>
    platform.events.some((e) => e.type === "RUN_FINISHED"),
  );
  assert.equal(platform.agentInputs[0].messages[0].content, text);
  assert.equal(
    platform.events.find((e) => e.type === "TEXT_MESSAGE_CONTENT").delta,
    text,
  );
  platform.faults.http.set("GET /api/inspector/metadata", {
    status: 200,
    body: {
      schemaVersion: 1,
      identity: { organizationName: text, projectName: text },
    },
  });
  assert.equal(
    (await request("GET", "/inspector-metadata")).body.identity.projectName,
    text,
  );
});

test(
  "oversized unterminated SSE frames fail before the agent closes",
  { timeout: 10000 },
  async (t) => {
    const agent = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("data: " + " ".repeat(1048577));
    });
    await new Promise((resolve) => agent.listen(0, "127.0.0.1", resolve));
    t.after(() => {
      agent.closeAllConnections();
      agent.close();
    });
    const { platform, request } = await setup(t, () => {}, {
      agentUrl: `http://127.0.0.1:${agent.address().port}/agent`,
    });
    assert.equal(
      (await request("POST", "/agent/default/run", input())).status,
      200,
    );
    await platform.waitFor(
      () => platform.events.some((event) => event.type === "RUN_ERROR"),
      3000,
    );
    assert.equal(
      platform.events.some((event) => event.type === "RUN_FINISHED"),
      false,
    );
  },
);

test("MCP discovery continues after an unavailable server", async (t) => {
  const { platform, request } = await setup(
    t,
    (fixture) => {
      fixture.faults.agentEvents = [{ type: "RUN_FINISHED" }];
    },
    (fixture) => ({
      mcpApps: {
        servers: [
          { type: "http", url: `${fixture.url}/missing-mcp` },
          {
            type: "http",
            url: fixture.mcpUrl,
            headers: { "x-fixture-auth": "mcp-fixture-token" },
          },
        ],
      },
    }),
  );
  assert.equal(
    (await request("POST", "/agent/default/run", input())).status,
    200,
  );
  await platform.waitFor(() => platform.agentInputs.length === 1);
  assert.ok(
    platform.agentInputs[0].tools.some((tool) => tool.name === "show_card"),
  );
});

test("MCP tool cancellation reaches its caller without a fallback result", async (t) => {
  const platform = await startPlatform();
  t.after(() => platform.close());
  const goal = `use_module(prolog/cpki_mcp),
    getenv('CPK_MCP_URL',Raw),atom_string(Raw,URL),
    nb_setval(emitted,0),
    assertz((emit_cancel(_):-nb_getval(emitted,N),Next is N+1,nb_setval(emitted,Next),throw(cpki_cancelled))),
    Server=_{type:"http",url:URL,headers:_{'x-fixture-auth':"mcp-fixture-token"}},
    catch(cpki_mcp:finish_call("call",_{name:"show_card",args:"{}"},
      _{server:Server,resource:"ui://fixture/card"},user:emit_cancel),cpki_cancelled,true),
    nb_getval(emitted,Count),(Count=:=1->halt(0);halt(1))`;
  const child = spawn("swipl", ["-q", "-g", goal], {
    env: { PATH: process.env.PATH, CPK_MCP_URL: platform.mcpUrl },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let logs = "";
  child.stderr.on("data", (data) => {
    logs += data;
  });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  const [code] = await once(child, "close", {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(code, 0, logs);
  assert.equal(platform.mcpCalls.length, 1);
});
