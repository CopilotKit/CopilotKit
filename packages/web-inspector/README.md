# @copilotkit/web-inspector

## Trusted project context

The Web Inspector reads optional `InspectorMetadataV1` data from
`@copilotkit/core`. It parses the value again at the UI boundary and renders each
valid module on its own:

- `identity` shows the organization and project in the Inspector header.
- `plan` shows the plan label in the header.
- `action` can show one trusted link in the header or locked Threads view.
- `usage` is carried by the shared contract but is not rendered in this release.

Missing or invalid metadata hides these trusted modules. The existing tabs,
debug views, and Threads endpoint behavior remain available; a locked Threads
view has no metadata action when trusted action data is absent.

### License and action matrix

| Effective license state | Header                                                      | Locked Threads view                                                                            |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `valid`                 | Shows `Manage plan` only for a trusted `manage_plan` action | Explains that the license is active but the runtime has no Threads endpoints; no locked action |
| `none`                  | No plan action                                              | Shows `Enable Intelligence` only for a trusted `enable_intelligence` action                    |
| `expired`               | No plan action                                              | Shows `Renew` for `renew`, or `Manage plan` for `manage_plan`                                  |
| `unknown`               | No plan action                                              | Uses neutral unavailable copy with no action                                                   |

The Inspector compares metadata license state with `licenseStatus` from the
runtime-info response. If both are known and disagree, it uses the Runtime
status for copy and hides the action. This avoids sending a user to an action
that does not match the runtime's current state.

Every action opens the exact URL accepted by the shared parser. The Inspector
does not add query parameters, derive URLs from names or IDs, or provide a
hard-coded signup fallback for the locked Threads metadata action.

### Thread selection stays unchanged

Metadata arrival, refresh, failure, and removal do not select or reselect a
thread. The Inspector keeps the existing selected row and detail view.

### Mixed versions

| Combination                                                      | Result                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| New Intelligence producer, Runtime, Core, and Inspector          | Trusted metadata is shown.                                                                               |
| Old Intelligence producer with a new Runtime                     | The provider `404` becomes a private `204`; no metadata is shown.                                        |
| New Intelligence producer with an old Runtime                    | The Runtime has no proxy or capability; no metadata is shown.                                            |
| New Core with an old Runtime                                     | Core sees no capability and skips the metadata request.                                                  |
| New Inspector with an old Core, or old Inspector with a new Core | The optional API is feature-detected or ignored; metadata stays absent and the Inspector remains usable. |

Roll out the Intelligence producer first, then release the OSS packages together
as one monorepo release.

### Privacy allowlist

The UI may render only the parsed organization name, project name, plan label,
license bucket, action kind, and trusted action URL. Metadata telemetry is
coarse: its feature-specific properties may include only `module`,
`action_kind`, and `license_bucket`. It must never copy names, account or
project IDs, thread IDs, URLs, usage values, limits, counts, or conversation
content into those events.

Usage impressions are not sent because there is no usage UI. Grouped Inspector
navigation is also not enabled. This change does not add a usage panel or alter
the current tab layout.

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

The standalone harness cannot prove the full identity, plan, action, locked
state, or mixed-version screenshot matrix because it mounts only the thread
Inspector with demo data. Do not treat this harness as full visual sign-off for
trusted metadata.
