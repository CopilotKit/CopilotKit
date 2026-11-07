import assert from "node:assert/strict";
import test from "node:test";
import { intelligenceConfig } from "../lib/intelligence-config";

test("threads belong to the configured local app user", () => {
  const result = intelligenceConfig({
    CPK_INTELLIGENCE_API_KEY: "test",
    CPK_APP_USER_ID: "local-app-user",
  });
  assert.equal(result.userId, "local-app-user");
  assert.deepEqual(result.intelligence, { apiKey: "test" });
});

test("partial configuration fails with guidance that names what is missing", () => {
  assert.throws(
    () => intelligenceConfig({ CPK_INTELLIGENCE_API_KEY: "test" }),
    /Check CPK_APP_USER_ID in \.env/,
  );
});
