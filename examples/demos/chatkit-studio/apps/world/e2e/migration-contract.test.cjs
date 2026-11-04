const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const routeSource = readFileSync(
  join(__dirname, "../src/app/api/copilotkit/route.ts"),
  "utf8",
);

test("forwards the browser OpenAI key through LangGraph assistant config", () => {
  assert.match(routeSource, /req\.headers\.get\("x-openai-api-key"\)/);
  assert.match(
    routeSource,
    /assistantConfig:\s*\{\s*configurable:\s*\{\s*openai_api_key:\s*userApiKey \|\| undefined,/s,
  );
});
