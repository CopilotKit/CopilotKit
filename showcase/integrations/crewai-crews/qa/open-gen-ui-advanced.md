# QA: Open-Ended Gen UI (Advanced) — CrewAI (Crews)

- [ ] Navigate to `/demos/open-gen-ui-advanced`.
- [ ] Click "Calculator (calls evaluateExpression)" suggestion.
- [ ] Verify a sandboxed calculator UI renders inside an iframe.
- [ ] Use the calculator (e.g. compute 3 + 4.5); verify the result updates from host-side `evaluateExpression`.
- [ ] Click "Ping the host (calls notifyHost)"; verify the button triggers a remote call and the timestamp is displayed in the sandbox.
