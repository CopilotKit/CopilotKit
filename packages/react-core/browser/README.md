# Open Generative UI browser regressions

Run `pnpm nx run @copilotkit/react-core:test:browser` from the workspace root.
Install the matching Chromium first with
`pnpm --dir packages/react-core exec playwright install chromium`.

The harness bundles the real React renderer and Websandbox. No iframe, script
execution, or browser readiness event is mocked. It listens on localhost only.

- `fixtures/calculator.json` preserves the HTML and JavaScript from PNI-585.
  Registering `DOMContentLoaded` after sandbox readiness leaves it inert.
  The supported variant changes only that readiness wrapper into a directly
  invoked initializer; its counter detects duplicate execution.
- `fixtures/normal-suggestion.json` is an unmodified gpt-5-mini-2025-08-07 tool
  response generated with the shared tool description on 2026-10-06. The user
  message was the normal Calculator App suggestion:

  > Using the generateSandboxedUi tool, build a modern calculator with standard buttons plus labeled metric shortcut buttons that insert their values into the display when clicked. Use sample company data.

Both supported fixtures exercise live expression delivery and saved-content
replay. Assertions cover arithmetic and metric buttons; the instrumented fixture
also checks initialization counts, reopening, and denied host/storage access.
The captured real-model response keeps CI deterministic and credential-free.

This contract change guides newly generated code. It does not rewrite historical
JavaScript or redispatch document readiness events; existing inert payloads must
be regenerated.
