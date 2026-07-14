# @copilotkit/web-inspector

## Standalone Inspector QA

Run the shared inspector without an app shell:

```bash
pnpm nx run @copilotkit/web-inspector:dev:standalone
```

Open [http://127.0.0.1:5177/](http://127.0.0.1:5177/).

The default view is a local-only Threads tab state lab. It mounts the real
`cpk-web-inspector` and changes mocked runtime/core state around it. The lab
mocks the runtime thread list and detail endpoints; it does not use static
mockups of the Inspector UI.

Threads tab validation steps:

1. Confirm the initial `Locked` scenario opens the full web inspector on the
   Threads tab and renders the Intelligence locked state.
2. Click `Enabled, empty` and confirm the real Threads tab renders the empty
   state.
3. Click `Enabled, populated` and confirm the real thread list/detail UI renders
   seeded thread history.
4. Click `List error` and confirm the real thread-list error state renders.
5. Click `Telemetry disabled` and confirm the enabled empty state still renders
   without emitting inspector telemetry.

The `Thread detail` mode keeps the lower-level thread inspector harness:

1. Confirm the initial `AG-UI events` scenario opens on the Timeline tab and renders run, message, and tool rows.
2. Click `Messages only` and confirm the first-visible Timeline renders persisted message content instead of an empty Timeline.
3. Click `Raw event only` and confirm the Timeline renders a `THREAD_STATE_WRITTEN` row with a source-event link.
4. Use a Timeline source-event link and confirm it opens the Raw AG-UI Events tab on the corresponding event.
5. Open the State tab and confirm the demo state is visible.

This harness uses demo provider data and mocked runtime capabilities only.
Manual product validation for Intelligence-backed threads still needs a real
Intelligence backend.
