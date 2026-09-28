# @copilotkit/web-inspector

## Embedded Intelligence views

The optional `intelligenceAppUrl` property adds Analytics and Governance to the
existing Inspector sidebar. Automatic Learning keeps its workbench and adds an
Insights & Skills view. The existing launcher, window controls, agent selector,
Rich Threads, Playground, and debug views keep their current behavior.

```ts
inspector.intelligenceAppUrl =
  "https://your-intelligence-host.example/inspector.html";
```

The Intelligence web app renders the new pages inside the Inspector content
pane. Charts and tables stay in that web app. The host bundle contains the iframe
and its request relay. HTTP URLs work only on loopback hosts for local development.

The iframe URL contains the parent origin, selected section, agent scope,
shared time window, and initial light or dark theme.
It contains no credentials. The host sends read requests through the existing
authenticated Runtime connection. The Runtime resolves the current user and
grant for each request, then calls an allowed Intelligence read endpoint.
The platform API key stays on the server.

The host keeps the committed time window across Analytics, Governance, and the
new Learning views. Time updates use the same exact-origin and source checks as
reads. Saving the window does not reload the current iframe or reset its detail
route. The original Learning workbench keeps its own controls.

Embedded views follow the Inspector's theme control and resolved system theme.
The host sends later theme changes through the checked message channel without
reloading the iframe, clearing drafts, or cancelling pending reads. The iframe
requests the current theme when it starts, so delayed loads also match the host.

Both sides check the exact message origin and source window. Closing a view
cancels its requests. A denied request removes the embedded content. The iframe
does not use the Intelligence console session or its authentication flow.
The iframe allows clipboard writes from its configured origin for Insight copy.
It does not request clipboard reads. The browser or host Permissions Policy can
still deny writes; the copy control reports failure and permits retry.

Conversation lists show metadata under `analytics.numbers`. Replay, tool arguments,
and tool error text require `conversations.text`. Replay shows recorded runs and
steps without controls that execute or resume a run. Deleted conversations show
a deletion notice.

The matching Intelligence build must enable its `inspector.intelligence-views`
release flag. This entry remains off by default in production during development.

## Trusted project context

The Web Inspector reads optional `InspectorMetadataV1` data from
`@copilotkit/core`. It parses the value again at the UI boundary and renders each
valid module on its own:

- `identity` shows the organization and project on the Home project card.
- `plan` shows the plan label on Home and in the Threads footer.
- `action` can show one trusted link in the Inspector sidebar, in the Threads
  footer, or in the locked Threads view.
- `usage` shows trusted Thread counts on Home and detailed usage and expiry data
  in the Threads footer.

Missing or invalid metadata hides only the affected trusted module. Home still
renders its project, runtime, services, and What's New preview with safe empty
states.
The existing debug views and Threads endpoint behavior remain available. A
licensed Runtime without Threads endpoints offers a static, docs-backed
coding-agent prompt and links to the public route setup guide.

The footer sits at the bottom of the Threads list sidebar. It stays out of the
account strip, other navigation groups, and Settings. Usage and the footer
action render on their own, so either module can appear without the other.

Home is the first pane on a new or upgraded installation. Later opens restore
the last selected pane. The live sidebar groups navigation into Home and What's
New, Workbench
(Threads and Memory), and Inspect (Agent, AG-UI Events, optional Frontend Tools
and Capabilities, and Context). Its Talk to an Engineer link stays in the footer,
followed by Intelligence and live Runtime connection status. Home previews the
latest update and opens the dedicated What's New pane.
Docked-left and narrow layouts use a compact icon rail; wider layouts can also
be collapsed manually. A top-right light/dark theme control follows the
Inspector between sessions without changing the host application's theme.
Unread announcements animate the closed launcher, appear as a Home preview,
and mark the What's New sidebar entry until the update is opened.

Metadata is display-only: it never authorizes or gates Thread work. Core starts
real Thread work only for object-valued `threadEndpoints` with `list !== false`.
Absent endpoints, literal `false`, or an endpoint object with `list: false`
produce zero list, subscribe, inspect, messages, events, and state requests.

### License and action matrix

| Effective license state | Threads footer                                                                                                                       | Locked Threads view                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `valid`                 | Shows `Manage Your Plan` below 90% finite usage and a purple `Upgrade Your Plan` at 90% or higher for a trusted `manage_plan` action | Copies a coding-agent repair prompt and links to the Rich Threads route setup guide when the Runtime has no Threads endpoints |
| `none`                  | No footer action                                                                                                                     | Shows `Enable Intelligence` only for a trusted `enable_intelligence` action                                                   |
| `expired`               | No footer action                                                                                                                     | Shows `Renew` for `renew`, or `Manage Your Plan` for `manage_plan`                                                            |
| `unknown`               | No footer action                                                                                                                     | Uses neutral unavailable copy with no action                                                                                  |

Finite usage shows `used / limit Threads` with a native progress bar. The bar is
green below 90%, orange from 90% up to the limit, and red at or above the limit.
At 90%, a trusted `manage_plan` footer link changes from `Manage Your Plan` to
the purple `Upgrade Your Plan` action without changing its URL or action kind. An overage shows
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

The usage UI does not add usage impressions or values to telemetry. The trusted
metadata footer action remains visible only on Threads. The existing metadata
action impression and click events keep their coarse allowlist.

### Embedded exports

Export controls create a server-side job, poll its status, and download through
the same authenticated runtime connection. Every operation resolves the current
user and grant. A revoked grant blocks an existing export. CSV metadata can be
saved with the separate Metadata JSON control; JSON files include it.

The runtime streams only JSON or CSV exports, capped at 50 MiB. The host transfers
file bytes into the iframe without forwarding a platform credential, download URL,
or upstream cookie. Ordinary screen reads keep their 5 MiB response cap.

## Read-only production mode (preview)

Set `intelligenceOnly = true` and `intelligenceAppUrl` before assigning `core`
and connecting the element. React applications can use the v2 provider's
`intelligenceInspector={{ appUrl }}` option. Outside local development it selects
this mode; local development retains the full existing Inspector.

Production reuses the same shell and sidebar. It fetches `/context` through the
host's authenticated Runtime transport before showing the launcher. Only granted
Analytics, Governance, and Learning sections appear, scoped to allowed agents.
There are no development panes, settings, run controls, or Learning mutations.
Development thread, memory, event, and Learning subscriptions do not start in
this mode, and it does not read or overwrite the development Inspector layout.

Header changes and window focus refresh the grant. A denied context or embedded
read clears the production surface. The Runtime still resolves permissions for
every data request; this display check does not replace server authorization.
The current embedded Learning lists require project-wide Learning permission.

Preview the actual shell locally with `intelligenceMode=production` alongside the
workbench's `intelligenceAppUrl` query parameter. Its data remains fixture data.
