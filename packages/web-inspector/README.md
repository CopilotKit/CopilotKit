# @copilotkit/web-inspector

## Trusted project context

The Web Inspector reads optional `InspectorMetadataV1` data from
`@copilotkit/core`. It parses the value again at the UI boundary and renders each
valid module on its own:

- `identity` shows the organization and project in the account strip.
- `plan` shows the plan label in the account strip.
- `action` can show one trusted link in the Threads footer or locked Threads view.
- `usage` shows trusted Thread counts and expiry data in the Threads footer.

Missing or invalid metadata hides these trusted modules. The existing tabs,
debug views, and Threads endpoint behavior remain available; a locked Threads
view has no metadata action when trusted action data is absent.

The footer sits at the bottom of the Threads list sidebar. It stays out of the
account strip, other navigation groups, and Settings. Usage and the footer
action render on their own, so either module can appear without the other.

The primary navigation groups the Inspector into Threads, Agents, and Learning.
Metadata is display-only: it never authorizes or gates Thread work. Core starts
real Thread work only for object-valued `threadEndpoints` with `list !== false`.
Absent endpoints, literal `false`, or an endpoint object with `list: false`
produce zero list, subscribe, inspect, messages, events, and state requests.

### License and action matrix

| Effective license state | Threads footer                                                                                                              | Locked Threads view                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `valid`                 | Shows `Manage Your Plan` below 90% finite usage and `Upgrade Your Plan` at 90% or higher for a trusted `manage_plan` action | Prompts the user to enable Threads when the runtime has no Threads endpoints; no locked action |
| `none`                  | No footer action                                                                                                            | Shows `Enable Intelligence` only for a trusted `enable_intelligence` action                    |
| `expired`               | No footer action                                                                                                            | Shows `Renew` for `renew`, or `Manage Your Plan` for `manage_plan`                             |
| `unknown`               | No footer action                                                                                                            | Uses neutral unavailable copy with no action                                                   |

Finite usage shows `used / limit Threads` with a native progress bar. The bar is
green below 90%, orange from 90% up to the limit, and red at or above the limit.
At 90%, a trusted `manage_plan` footer link changes from `Manage Your Plan` to
`Upgrade Your Plan` without changing its URL or action kind. An overage shows
`limit+ / limit Threads` and caps the bar at 100%. Unlimited limits use text
only. An unknown limit shows the trusted used count with `Limit unavailable`;
it invents neither a numeric limit nor progress. A known zero expiry count stays
visible; missing or malformed expiry data stays hidden.

`Expiring Soon` describes a future retention-policy threshold in the next 24
hours. The Inspector does not enforce retention, lock or delete Threads, or run
the thread culler.

Managed Enterprise metadata has no manage-plan action, and Team Self-Hosted
metadata has no hosted action. Any supplied action must match the effective
license state and action kind in the matrix above.

The Inspector compares metadata license state with `licenseStatus` from the
runtime-info response. If both are known and disagree, it uses the Runtime
status for copy and hides the action. This avoids sending a user to an action
that does not match the runtime's current state without hiding valid usage.

Every action opens the exact URL accepted by the shared parser. The Inspector
does not add query parameters, derive URLs from names or IDs, or provide a
hard-coded signup fallback for the locked Threads metadata action.

### Thread selection stays unchanged

Metadata arrival, refresh, failure, and removal do not select or reselect a
thread. The Inspector keeps the existing selected row and detail view.

### Mixed versions

| Combination                                    | Result                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Old producer with new Shared and Runtime       | V1 usage remains valid without `expiringSoonCount`; expiry stays absent.                      |
| New producer with pre-expiry Shared or Runtime | The older consumer ignores or removes the additive expiry leaf and keeps valid base V1 usage. |
| Old App API with new Runtime                   | The provider `404` becomes a private `204`; Core stays connected and metadata stays absent.   |
| New App API with old Runtime                   | The Runtime makes no metadata request, and the current Inspector behavior stays unchanged.    |
| New Runtime or Core with old Inspector         | The old Inspector ignores metadata it does not render.                                        |
| New Inspector with old Core or Runtime         | The Inspector feature-detects support and renders the safe missing-metadata fallback.         |

These combinations do not require synchronized deployment. Roll out the
Intelligence producer first, then release each consumer when ready. Explicit
`threadEndpoints` remain the authority in every mix; metadata never enables
Thread work, and a license conflict suppresses an incompatible action without
suppressing valid usage.

### Privacy allowlist

The UI may render only the parsed organization name, project name, plan label,
license bucket, action kind, trusted action URL, and trusted Thread usage fields:
used count, limit kind and value, and expiry count. Metadata telemetry is
coarse: its feature-specific properties may include only `module`,
`action_kind`, `license_bucket`, `usage_bucket`, `expiry_bucket`, `group_key`,
`leaf_key`, and `action_placement`. It must never copy exact usage, limits,
expiry counts, content, names, URLs, or Thread, agent, message, account, project,
or other product IDs into those events. It retains only the anonymous
identifiers already used by Inspector telemetry.

The usage UI does not add usage impressions or values to telemetry. Grouped
Inspector navigation shows the footer only on Threads. The existing metadata
action impression and click events keep their coarse allowlist.
