// Runtime half of tsconfig.json: load the BUILT root entry, in both published
// formats, with every model SDK made unresolvable, then run a factory
// BuiltInAgent to the end.
//
// validate-optional-peer-entries.ts proves the same from the import graph.
// This proves it by loading the code: a consumer of `@copilotkit/runtime` who
// installed neither `ai` nor `@tanstack/ai` must be able to import it and run
// an agent whose factory owns the model call.
//
// Run by `pnpm --filter @copilotkit/runtime check-dts`, after `build`.
import assert from "node:assert/strict";
import Module, { createRequire, register } from "node:module";

const BLOCKED = /^(ai|ai\/.*|@ai-sdk\/.*|@tanstack\/ai.*)$/;

function notFound(specifier) {
  const error = new Error(
    `no-ai-sdk check: "${specifier}" is not installed for this consumer`,
  );
  error.code = "MODULE_NOT_FOUND";
  return error;
}

// ESM: `import` resolution goes through the loader hooks.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      const BLOCKED = ${BLOCKED};
      export async function resolve(specifier, context, next) {
        if (BLOCKED.test(specifier)) {
          const error = new Error('no-ai-sdk check: "' + specifier + '" is not installed for this consumer');
          error.code = "ERR_MODULE_NOT_FOUND";
          throw error;
        }
        return next(specifier, context);
      }
    `),
);

// CJS: `require()` resolution goes through Module._resolveFilename.
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (BLOCKED.test(request)) throw notFound(request);
  return resolveFilename.call(this, request, ...rest);
};

// Without this, a blocker that silently stopped working would read as a pass.
await assert.rejects(import("ai"), { code: "ERR_MODULE_NOT_FOUND" });
assert.throws(() => createRequire(import.meta.url)("@tanstack/ai"), {
  code: "MODULE_NOT_FOUND",
});

const require = createRequire(import.meta.url);
const builds = {
  esm: await import("../../dist/index.mjs"),
  cjs: require("../../dist/index.cjs"),
};

for (const [format, { BuiltInAgent }] of Object.entries(builds)) {
  const agent = new BuiltInAgent({
    type: "custom",
    async *factory({ input }) {
      yield {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: `${input.runId}-reply`,
        role: "assistant",
        delta: "hello",
      };
    },
  });

  const events = [];
  await new Promise((resolve, reject) => {
    agent
      .run({
        threadId: "thread-1",
        runId: "run-1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      })
      .subscribe({
        next: (event) => events.push(event),
        error: reject,
        complete: resolve,
      });
  });

  assert.deepEqual(
    events.map((event) => [event.type, event.delta]),
    [
      ["RUN_STARTED", undefined],
      ["TEXT_MESSAGE_CHUNK", "hello"],
      ["RUN_FINISHED", undefined],
    ],
    `${format}: the factory agent did not run to completion`,
  );
}

console.log("no-ai-sdk: root entry loads and runs without a model SDK.");
