import { test } from "node:test";
import assert from "node:assert/strict";
import * as consumer from "./typescript.mjs";

for (const adapterId of ["mastra-ts", "langgraph-ts"]) {
  test(`${adapterId} uses the published runtime dependency even when versions differ`, () => {
    const plan = { adapterId, adapterVersion: "1.71.2" };
    const env = { HOME: "/isolated-home" };
    const runtime = consumer.publishedRuntime(
      plan,
      env,
      (file, args, options) => {
        assert.equal(file, "npm");
        assert.deepEqual(args, [
          "view",
          `@copilotkit/intelligence-${adapterId === "mastra-ts" ? "mastra" : "langgraph"}@1.71.2`,
          "dependencies",
          "--json",
        ]);
        assert.equal(options.env, env);
        return JSON.stringify({ "@copilotkit/runtime": "1.73.0" });
      },
    );
    assert.deepEqual(runtime, {
      dependencies: { "@copilotkit/runtime": "1.73.0" },
      overrides: {},
    });
  });
}
test("missing runtime dependency fails instead of guessing the adapter version", () => {
  assert.throws(
    () =>
      consumer.publishedRuntime(
        { adapterId: "mastra-ts", adapterVersion: "1.71.2" },
        {},
        () => "{}",
      ),
    /runtime dependency/,
  );
});
