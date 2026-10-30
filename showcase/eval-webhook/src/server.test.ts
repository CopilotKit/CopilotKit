import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "test-secret";

function startServer(secret: string | undefined, port = 0): ChildProcess {
  const env = { ...process.env, PORT: String(port) };
  delete env.GITHUB_WEBHOOK_SECRET;
  if (secret !== undefined) env.GITHUB_WEBHOOK_SECRET = secret;
  return spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: projectDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as { port: number };
  probe.close();
  await once(probe, "close");
  return port;
}

const hmac = (key: string, payload: string) =>
  crypto.createHmac("sha256", key).update(payload).digest("hex");

describe("without a usable GITHUB_WEBHOOK_SECRET", () => {
  for (const [label, secret] of [
    ["unset", undefined],
    ["empty", ""],
    ["blank", "   "],
  ] as const) {
    it(`refuses to start when the secret is ${label}`, async () => {
      const server = startServer(secret);
      let output = "";
      server.stdout!.on("data", (chunk) => (output += chunk));
      server.stderr!.on("data", (chunk) => (output += chunk));

      try {
        const [code] = await once(server, "exit", {
          signal: AbortSignal.timeout(20_000),
        });
        assert.notEqual(code, 0);
      } finally {
        server.kill("SIGKILL");
      }
      assert.match(output, /GITHUB_WEBHOOK_SECRET must be set/);
      assert.doesNotMatch(output, /listening/);
    });
  }
});

describe("with GITHUB_WEBHOOK_SECRET set", () => {
  let server: ChildProcess;
  let baseUrl: string;

  before(async () => {
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = startServer(SECRET, port);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await fetch(`${baseUrl}/api/health`).catch(() => null)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("server did not start");
  });

  after(() => {
    server.kill("SIGKILL");
  });

  const postWebhook = (signature: string) =>
    fetch(`${baseUrl}/webhooks/github`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature, "x-github-event": "ping" },
      body: "{}",
    });

  it("reports healthy", async () => {
    const res = await fetch(`${baseUrl}/api/health`);

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it("accepts a webhook signed with the secret", async () => {
    const res = await postWebhook(`sha256=${hmac(SECRET, "{}")}`);

    assert.equal(res.status, 200);
  });

  it("rejects a webhook signed with an empty key", async () => {
    const res = await postWebhook(`sha256=${hmac("", "{}")}`);

    assert.equal(res.status, 401);
  });

  it("escapes pr in the trigger page", async () => {
    const pr = `1"><script>alert(1)</script>`;
    const params = new URLSearchParams({
      pr,
      check_run_id: "2",
      sig: hmac(SECRET, `${pr}:2`),
    });

    const res = await fetch(`${baseUrl}/trigger/eval?${params}`);
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.doesNotMatch(body, /<script>/);
    assert.match(body, /&lt;script&gt;/);
    assert.match(body, /value="1&quot;&gt;&lt;script&gt;/);
  });
});
