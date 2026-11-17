import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, POST } from "../src/app/api/copilotkit/[[...slug]]/route";
import { createVisitorSessions } from "../src/lib/visitor-session";

const baseUrl = "http://localhost/api/copilotkit";
const chatAgent = "agentic_chat";

function request(path: string, body?: unknown, token?: string) {
  return new Request(`${baseUrl}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createSession(agentId = chatAgent) {
  const response = await POST(request("session", { agentId }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const session = (await response.json()) as {
    threadId: string;
    token: string;
  };
  assert.ok(session.threadId);
  assert.ok(session.token);
  return session;
}

test("the Omnara runtime binds a browser session to its demo, visitor, and thread", async (t) => {
  const env = {
    OMNARA_API_KEY: "test-server-only-key",
    OMNARA_ORG_ID: "org_test",
    OMNARA_PROJECT_ID: "proj_test",
  };
  for (const [key, value] of Object.entries(env)) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }

  const visitor = await createSession();
  const other = await createSession();
  assert.notEqual(visitor.threadId, other.threadId);
  assert.notEqual(visitor.token, other.token);

  const resume = await POST(
    request("session", { agentId: chatAgent }, visitor.token),
  );
  assert.equal(resume.status, 200);
  assert.deepEqual(await resume.json(), visitor);
  assert.equal(
    (await POST(request("session", { agentId: "not-a-demo" }))).status,
    400,
  );
  assert.equal(
    (await POST(request("session", { agentId: chatAgent }, "invalid"))).status,
    401,
  );
  const forgedToken = visitor.token.replace(visitor.threadId, other.threadId);
  assert.equal(
    (await GET(request("info", undefined, forgedToken))).status,
    401,
  );

  const info = await GET(request("info", undefined, visitor.token));
  assert.equal(info.status, 200);
  assert.equal((await GET(request("info"))).status, 401);

  const foreignRun = { threadId: other.threadId, runId: "foreign-run" };
  for (const path of [
    `agent/${chatAgent}/run`,
    `agent/${chatAgent}/connect`,
    `agent/${chatAgent}/stop/${other.threadId}`,
  ]) {
    assert.equal((await POST(request(path, foreignRun))).status, 401);
    const forbidden = await POST(request(path, foreignRun, visitor.token));
    assert.equal(forbidden.status, 403, path);
  }
  assert.equal(
    (
      await POST(
        request(
          "agent/frontend_tools/connect",
          { threadId: visitor.threadId },
          visitor.token,
        ),
      )
    ).status,
    403,
  );

  const connect = await POST(
    request(
      `agent/${chatAgent}/connect`,
      { threadId: visitor.threadId, runId: "connect-test", messages: [] },
      visitor.token,
    ),
  );
  assert.equal(connect.status, 200);
  await connect.text();
});

test("a new runtime rejects a previous session and can issue a fresh one", async () => {
  const runtime = createVisitorSessions();
  const created = await runtime.startOrResume(
    request("session", { agentId: chatAgent }),
  );
  const oldSession = (await created.json()) as {
    threadId: string;
    token: string;
  };

  const restarted = createVisitorSessions();
  const expired = await restarted.startOrResume(
    request("session", { agentId: chatAgent }, oldSession.token),
  );
  assert.equal(expired.status, 401);
  assert.match((await expired.json()).error, /Start a new chat/);

  const fresh = await restarted.startOrResume(
    request("session", { agentId: chatAgent }),
  );
  assert.equal(fresh.status, 200);
  assert.notEqual((await fresh.json()).threadId, oldSession.threadId);
});
