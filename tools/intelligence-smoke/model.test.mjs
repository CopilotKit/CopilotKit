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
