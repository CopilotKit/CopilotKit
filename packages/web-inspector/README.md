# @copilotkit/web-inspector

## Trusted project context

The Web Inspector reads optional `InspectorMetadataV1` data from
`@copilotkit/core`. It parses the value again at the UI boundary and renders each
valid module on its own:

- `identity` shows the organization and project in the Inspector header.
- `plan` shows the plan label in the header.
- `action` can show one trusted link in the Threads footer or locked Threads view.
- `usage` shows trusted Thread counts and expiry data in the Threads footer.

Missing or invalid metadata hides these trusted modules. The existing tabs,
debug views, and Threads endpoint behavior remain available; a locked Threads
view has no metadata action when trusted action data is absent.

The footer sits at the bottom of the Threads list sidebar. It stays out of the
account strip, other navigation groups, and Settings. Usage and the footer
action render on their own, so either module can appear without the other.

### License and action matrix

| Effective license state | Threads footer                                                   | Locked Threads view                                                                            |
| ----------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `valid`                 | Shows `Manage Your Plan` only for a trusted `manage_plan` action | Explains that the license is active but the runtime has no Threads endpoints; no locked action |
| `none`                  | No footer action                                                 | Shows `Enable Intelligence` only for a trusted `enable_intelligence` action                    |
| `expired`               | No footer action                                                 | Shows `Renew` for `renew`, or `Manage Your Plan` for `manage_plan`                             |
| `unknown`               | No footer action                                                 | Uses neutral unavailable copy with no action                                                   |

Finite usage shows a native progress bar. Counts above the limit clamp to the
limit and use a `+` suffix. Unlimited and unknown limits use text only. A known
zero expiry count stays visible; missing expiry data stays hidden.

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

The usage UI does not add usage impressions or values to telemetry. Grouped
Inspector navigation shows the footer only on Threads. The existing metadata
action impression and click events keep their coarse allowlist.

## Standalone Inspector Threads lab

Run the full Inspector against a deterministic loopback Runtime:

```bash
pnpm nx run @copilotkit/web-inspector:dev:standalone
```

Open [http://127.0.0.1:5177/](http://127.0.0.1:5177/). The server binds only to
`127.0.0.1` and uses strict port `5177`, so it fails instead of moving to a new
port when that port is busy. It does not connect to an external Intelligence
service.

Each route mounts a real `CopilotKitCore` and `cpk-web-inspector` against local
REST and Phoenix V2 WebSocket endpoints. The page shows the normalized fixture,
the expected and actual counts for all six Thread request kinds, and the request
log.

### Recording links

Use this canonical link shape:

```text
http://127.0.0.1:5177/?scenario=<key>&reset=1
```

Start a recording with the approved Free usage state:

[http://127.0.0.1:5177/?scenario=free-figma-148-of-200&reset=1](http://127.0.0.1:5177/?scenario=free-figma-148-of-200&reset=1)

It shows `148 / 200 Threads`, `37 Expiring Soon`, the finite progress bar, and
the managed plan action. The `free-overage-241-of-200` route shows the matching
overage state: `200+ / 200 Threads`, `0 Expiring Soon`, and a full progress bar.

### Core matrix

The first 16 routes cover every combination of plan or deployment, Threads
capability, and data state:

| Route prefix  | Deployment  | Usage limit | Managed plan action |
| ------------- | ----------- | ----------- | ------------------- |
| `pro`         | Managed     | 5,000       | Yes                 |
| `team`        | Managed     | 25,000      | Yes                 |
| `enterprise`  | Managed     | Unlimited   | No                  |
| `self-hosted` | Self-hosted | 25,000      | No                  |

Each prefix has `enabled-zero`, `enabled-existing`, `disabled-zero`, and
`disabled-existing` routes. Disabled routes can include seeded rows, but all six
real request counts must remain zero.

The other 15 routes cover absent capability and metadata, unknown or malformed
usage, missing expiry, usage-only and action-only metadata, locked and expired
licenses, list and video errors, reduced motion, and disabled telemetry. The
scenario selector lists all 31 routes in the fixed test order.

### Local demo and reset behavior

Enabled routes with no real rows keep the product's video, three example
threads, detail tabs, and guided tour. `video-error` blocks media in the lab so
the fallback can be tested without changing the product video URL.
`reduced-motion` starts the video paused and keeps the labelled play control.

`Reset` tears down the current Core and stores, clears only these two keys, resets
the server ledger, and reloads the canonical route:

```text
cpk:inspector:state
cpk:inspector:threads-example-tour:v1
```

It preserves announcement, telemetry, app, and unrelated local-storage data.
