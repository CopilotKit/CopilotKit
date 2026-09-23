import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { startPlatform } from "../platform.mjs";

test("the platform can send headers before a delayed entitlement body", async () => {
  const platform = await startPlatform();
  try {
    platform.faults.http.set("GET /api/entitlements/runtime", {
      status: 200,
      body: { status: "ready" },
      bodyDelayMs: 200,
    });
    const response = await fetch(`${platform.url}/api/entitlements/runtime`, {
      headers: { authorization: `Bearer ${platform.apiKey}` },
      signal: AbortSignal.timeout(2000),
    });
    let bodyFinished = false;
    const body = response.json().then((value) => {
      bodyFinished = true;
      return value;
    });

    await delay(20);

    assert.equal(response.status, 200);
    assert.equal(
      bodyFinished,
      false,
      "headers must arrive before the delayed body",
    );
    assert.deepEqual(await body, { status: "ready" });
  } finally {
    await platform.close();
  }
});
