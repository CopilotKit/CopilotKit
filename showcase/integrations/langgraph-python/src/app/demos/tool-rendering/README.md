# Tool Rendering

Backend agent tool calls are rendered as React components in the chat
transcript. The frontend uses `useRenderTool` to register a renderer per tool
name, receiving `args`, `result`, and `status` so the UI can reflect both
in-flight and completed calls.

A failed weather result shows an error instead of an empty weather card. The
agent ends the failed tool batch before requesting another model answer. Retry
submits the original user prompt through the chat's normal submission handler;
the button is disabled while a run is active. Successful tool rendering is
unchanged.

Run the real browser regression against an owned local demo and aimock P1 replay
instance (from the repository root):

```sh
SHOWCASE_TEST_URL=http://localhost:3500/demos/tool-rendering \
AIMOCK_URL=http://localhost:4410 AIMOCK_CONTEXT=langgraph-python \
pnpm nx run @copilotkit/showcase-harness:test:e2e -- \
  test/e2e/tool-rendering-error.test.ts --maxWorkers=1 --minWorkers=1
```

The test injects one invalid-JSON weather call per viewport, checks the visible
failure, clicks Retry and checks actual recovery. It uses only loopback URLs and
adds three fixtures per viewport under a unique context. Set `SHOWCASE_PROOF_DIR`
to choose where screenshots, streamed responses and journals are saved. The
test removes its runtime fault scopes; its isolated fixtures remain until the
owned aimock process is stopped. Do not run it against a shared instance.

The canonical description lives in the showcase manifest; this README is just
a developer note alongside the demo source.
