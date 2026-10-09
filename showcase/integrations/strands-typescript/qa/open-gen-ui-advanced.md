# QA — open-gen-ui-advanced

## Scope

Manual QA for the advanced Open Generative UI demo. Builds on open-gen-ui
by adding `openGenerativeUI.sandboxFunctions` (evaluateExpression,
notifyHost) that the agent-authored iframe can invoke via
`Websandbox.connection.remote.<name>(...)`.

## Happy path

- [ ] Navigate to `/demos/open-gen-ui-advanced`.
- [ ] Composer shows three sandbox-function suggestion pills.
- [ ] Click "Calculator (calls evaluateExpression)" — a calculator mounts
      in a sandboxed iframe. Press a few digits and `=` — the display
      shows the evaluated result.
- [ ] Click "Ping the host (calls notifyHost)" — a card mounts with a
      "Say hi to the host" button. Clicking it shows a host-returned
      confirmation with a `receivedAt` timestamp.

## Regression

- [ ] Check the browser console for `[open-gen-ui/advanced]` log lines
      proving the sandbox -> host round trip fired.

## Known gaps

- Same Strands backend as the minimal variant.
