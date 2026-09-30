import assert from "node:assert/strict";
import test from "node:test";
import { intelligenceConfig } from "../lib/intelligence-config";

test("thread binding and skill delivery share the server-controlled container", () => {
  const result = intelligenceConfig({
    CPK_INTELLIGENCE_API_KEY: "test",
    CPK_INTELLIGENCE_LEARNING_CONTAINER_ID: "my-container",
    CPK_APP_USER_ID: "local-app-user",
  });
  assert.equal(
    result.intelligence.getLearningContainerId(),
    result.containerId,
  );
  assert.equal(result.userId, "local-app-user");
});

test("partial configuration cannot silently run without Learning", () => {
  assert.throws(
    () => intelligenceConfig({ CPK_INTELLIGENCE_API_KEY: "test" }),
    /incomplete/,
  );
});
