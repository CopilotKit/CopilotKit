# Beautiful Chat todo regression

This shared browser test drives the actual page, runtime, and agent. It creates
two tasks with notes, completes one task, then reopens it. After each checkbox
change it asks the agent to read the board, checking that the backend round trip
preserves both tasks and notes. Run the same script for every integration; only
the model fixtures vary by integration.

Start the integration with aimock in strict replay mode, including
`showcase/aimock/d6/google-adk/beautiful-chat-todos.json` for ADK. The fixture
intentionally mixes a canonical board todo and a legacy `completed`/`notes`
todo, so the original sales helper fails the first visible-board assertion.
These are deterministic regression fixtures, not captured live model responses.

```sh
pnpm nx run showcase-shared-python:test:todos
BEAUTIFUL_CHAT_URL=http://localhost:<port>/demos/beautiful-chat \
  BEAUTIFUL_CHAT_SCREENSHOT=/tmp/beautiful-chat-todos.png \
  pnpm nx run showcase-shared-python:test:todos:browser
```

Python checks require Python 3.10+ and pytest. The browser test uses the harness's
Playwright installation and Chromium. `BEAUTIFUL_CHAT_SCREENSHOT` is optional;
when set, a screenshot is saved on either pass or failure.

The default Python `test` target covers the new board contract and existing
sales-todo contract. `test:all` runs the entire pre-existing shared Python suite,
including unrelated flight/A2UI tests. The browser regression is an explicit
target, not registered as a scheduled D6 probe; the current Beautiful Chat D6
family excludes Task Manager.

This test does not validate Intelligence storage, thread selection, or import.
Native persistence/restart and Intelligence replay need their own running
services and checks in addition to this browser regression.
