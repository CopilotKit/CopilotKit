import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";
import { startModel, scenario } from "./model.mjs";

const require = createRequire(
  new URL("../../packages/runtime/package.json", import.meta.url),
);
const aimock = require("@copilotkit/aimock");

test("unknown model requests fail and prevent a green coverage result", async () => {
  const model = await startModel({ aimock });
  try {
    const response = await fetch(`${model.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "unexpected",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    assert.equal(response.status, 503);
    assert.throws(() => model.evidence(), /unexpected|unmatched/i);
  } finally {
    await model.stop();
  }
});

test("missing model phases cannot appear green", async () => {
  const model = await startModel({ aimock });
  try {
    assert.throws(() => model.evidence(), /missing/i);
  } finally {
    await model.stop();
  }
});

test("checked-in replies cover the agent and each Learning phase", async () => {
  const model = await startModel({ aimock });
  try {
    for (const request of fixtureInput()) {
      const response = await fetch(`${model.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      assert.equal(response.status, 200, await response.text());
    }
    assert.equal(model.evidence().requests.length, 5);
  } finally {
    await model.stop();
  }
});

test("a transcript with an incorrect reply does not match the Learning fixture", async () => {
  const model = await startModel({ aimock });
  try {
    const request = fixtureInput()[2];
    for (const initial of fixtureInput().slice(0, 2))
      await send(model, initial);
    request.messages.at(-1).content = request.messages
      .at(-1)
      .content.replace("Smoke reply saved.", "BROKEN");
    const response = await fetch(`${model.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    assert.equal(response.status, 503);
  } finally {
    await model.stop();
  }
});

async function send(model, request) {
  return fetch(`${model.url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
}

test("out-of-order phases are rejected", async () => {
  const model = await startModel({ aimock });
  try {
    assert.equal((await send(model, fixtureInput().at(-1))).status, 503);
  } finally {
    await model.stop();
  }
});

for (const mutation of ["wrong-role", "appended-corruption", "extra-line"]) {
  test(`transcript fixture rejects ${mutation}`, async () => {
    const model = await startModel({ aimock });
    try {
      for (const initial of fixtureInput().slice(0, 2))
        assert.equal((await send(model, initial)).status, 200);
      const request = fixtureInput()[2];
      if (mutation === "wrong-role") {
        request.messages[0].content = request.messages.at(-1).content;
        request.messages.at(-1).content = "## Thread wrong\nBROKEN";
      } else
        request.messages.at(-1).content +=
          mutation === "extra-line" ? "\nCORRUPTED" : "CORRUPTED";
      assert.equal((await send(model, request)).status, 503);
    } finally {
      await model.stop();
    }
  });
}

test("Learning fixtures bind a generated snapshot ID and preserve it through reduction", async () => {
  const model = await startModel({ aimock });
  const snapshotId = "01a10e90-c403-7ecf-8bfc-c6ec393e1dd8";
  try {
    for (const request of fixtureInput()) {
      const bound = JSON.parse(
        JSON.stringify(request).replaceAll(scenario.threadId, snapshotId),
      );
      const response = await send(model, bound);
      assert.equal(response.status, 200, await response.clone().text());
      if (request.tools.some((t) => t.function.name === "read_evidence")) {
        assert.ok((await response.text()).includes(snapshotId));
      }
    }
    assert.equal(model.evidence().snapshotId, snapshotId);
  } finally {
    await model.stop();
  }
});

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"),
);
/** Representative requests expose the fixture contract for its self-test. */
function fixtureInput() {
  return fixture.phases.map((phase) => ({
    model: phase.match.model,
    messages: [
      {
        role: "user",
        content:
          phase.id === "agent"
            ? scenario.prompt
            : phase.match.hasToolResult
              ? "Find private candidate Insight changes"
              : phase.requiredText.join("\n"),
      },
      ...(phase.match.hasToolResult
        ? [
            {
              role: "tool",
              tool_call_id: "sample",
              content: phase.requiredText.join("\n"),
            },
          ]
        : []),
    ],
    tools: phase.tools.map((name) => ({
      type: "function",
      function: { name, parameters: { type: "object", properties: {} } },
    })),
  }));
}
