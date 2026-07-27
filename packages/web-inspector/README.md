# @copilotkit/web-inspector

## Standalone Thread Inspector QA

Run the shared inspector without an app shell:

```bash
pnpm nx run @copilotkit/web-inspector:dev:standalone
```

Open [http://127.0.0.1:5177/](http://127.0.0.1:5177/).

Validation steps:

1. Confirm the initial `AG-UI events` scenario opens on the Timeline tab and renders run, message, and tool rows.
2. Click `Messages only` and confirm the first-visible Timeline renders persisted message content instead of an empty Timeline.
3. Click `Raw event only` and confirm the Timeline renders a `THREAD_STATE_WRITTEN` row with a source-event link.
4. Use a Timeline source-event link and confirm it opens the Raw AG-UI Events tab on the corresponding event.
5. Open the State tab and confirm the demo state is visible.

This harness uses demo provider data only. Manual product validation for Intelligence-backed threads still needs a real Intelligence backend.
