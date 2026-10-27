import assert from "node:assert/strict";
import test from "node:test";
import { intelligenceConfig } from "../server/lib/intelligence-config";

test("requires a project key and Learning Container", () => {
  assert.throws(
    () => intelligenceConfig({}),
    /Intelligence setup is incomplete/,
  );
});

test("binds new threads to the selected Learning Container", () => {
  const config = intelligenceConfig({
    CPK_INTELLIGENCE_API_KEY: "test-key",
    CPK_INTELLIGENCE_LEARNING_CONTAINER_ID: "mobile-chat",
    CPK_APP_USER_ID: "local-user",
  });
  assert.equal(config.intelligence.getLearningContainerId(), "mobile-chat");
  assert.equal(config.userId, "local-user");
});
