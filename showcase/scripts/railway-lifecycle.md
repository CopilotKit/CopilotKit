# Railway disposable ownership contract

Set `SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE` to a durable JSON snapshot published
by the lifecycle writer. This contract covers read-only registry classification;
the PNI-605/PNI-606 runbook remains the source for execution plans and status.

PNI-605 owns creation, restart, readiness, record publication, and cleanup.
PNI-606 owns the schedule: one run every four hours. PNI-607 reads evidence and
classifies membership, presence, images, and permanent fleet eligibility. It
does not create resources, run a timer, or grant deletion authority.

## Evidence and trust

The configured file path is the trust boundary. Only the lifecycle writer and
operator may publish there. Restrict directory and file writes to those actors;
mount the directory read-only for readers. A name prefix, label, digest-shaped
string, or caller-supplied resource list does not prove ownership. Records must
contain exact IDs already returned by the provider, with no credentials or
service environment values.

| Configuration                                             | Meaning                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Variable unset                                            | Evidence unavailable; no disposable exemptions.                           |
| Readable `{"schemaVersion":1,"runs":[]}`                  | Explicit no-run snapshot.                                                 |
| Configured but missing, unreadable, malformed, or invalid | Visible typed failure; no exemptions. Never substitute an empty snapshot. |

Publish the whole snapshot atomically: validate it, write a new private temporary
file in the same directory, flush and close it, rename it over the configured
file, and sync the directory where supported. Serialize writers so an update
cannot lose another record. Keep a durable volume behind this directory; a
container-local file will not survive replacement. Mount the directory rather
than one file so readers see replacements after rename.

Append new runs and update existing runs in each snapshot. Retain terminal and
expired records so readers can identify leftovers. Partial setup may have no
services or only those whose creation returned an ID. PNI-605 must keep creation
intent separately for ambiguous provider calls: an unrecorded live resource gets
no exemption. This module supplies no writer or recovery controller.

## Record schema

All fields below are required, and extra fields are rejected. IDs and names are
nonempty trimmed strings. `RunRecordsSnapshot` is:

```ts
{
  schemaVersion: 1;
  runs: {
    runId: string;
    projectId: string;
    environmentId: string;
    startedAt: string;
    expiresAt: string;
    phase: "setup" | "ready" | "teardown" | "complete" | "interrupted";
    services: {
      name: string;
      serviceId: string;
      expectedImage: string;
    }
    [];
    resources: {
      kind: string;
      id: string;
    }
    [];
  }
  [];
}
```

Times use UTC ISO form `YYYY-MM-DDTHH:mm:ss[.SSS]Z`. Start cannot be in the
future. Expiry must follow start by at most 60 minutes. At most one `setup`,
`ready`, or `teardown` run may be unexpired at the validation time. This is a
validation rule, not a lock or scheduler.

Run IDs, service IDs, and environment ownership cannot repeat across retained
runs. Resource `(kind,id)` pairs cannot repeat. Within a run, service names
cannot repeat. A disposable name or service ID cannot collide with the permanent
registry. `resources` records all other known provider resources, such as volumes
and the environment; `kind: "service"` is rejected, and an `environment` resource
must equal the run's `environmentId`.

This JSON illustrates a partial setup snapshot. Every ID is fictitious, including
the project; it requires a matching fixture policy and is not live evidence:

```json
{
  "schemaVersion": 1,
  "runs": [
    {
      "runId": "fixture-run-1",
      "projectId": "fixture-project",
      "environmentId": "fixture-environment",
      "startedAt": "2026-10-08T12:00:00Z",
      "expiresAt": "2026-10-08T13:00:00Z",
      "phase": "setup",
      "services": [],
      "resources": [{ "kind": "environment", "id": "fixture-environment" }]
    }
  ]
}
```

## Independent image policy

[`railway-envs.ts`](./railway-envs.ts) exports `DISPOSABLE_LIFECYCLE_POLICY`.
Its exact shape is `{projectId, forbiddenEnvironmentIds, permanentServices,
approvedImages}`, where `permanentServices` contains `{name, serviceId}` pairs
and the other two lists contain strings. The generated JSON exposes the same
object at `disposableLifecyclePolicy`.

The initial committed `approvedImages` list is **empty**. No disposable service
can be accepted until real immutable pins receive separate review and are added
to that list. An empty-service setup record can validate; this does not authorize
deployment. Receipts cannot approve their own images. Each `expectedImage` must
exactly match a listed `registry/repository@sha256:<64 lowercase hex characters>`
reference. Nested GHCR repositories and external dependency registries work only
when their full references are approved. A different approved pin still fails an
observed service's exact expected-image check.

This policy JSON is for offline fixtures only, with no approved pins:

```json
{
  "projectId": "fixture-project",
  "forbiddenEnvironmentIds": ["fixture-production"],
  "permanentServices": [
    { "name": "fixture-permanent", "serviceId": "fixture-service" }
  ],
  "approvedImages": []
}
```

The committed project ID is `6f8c6bff-a80d-4f8f-b78d-50b32bcf4479`.
Staging is `8edfef02-ea09-4a20-8689-261f21cc2849`. Production,
`b14919f4-6417-429f-848d-c6ae2201e04f`, is forbidden for disposable records.
The 49 permanent service IDs come from `SERVICES`; dynamic records never enter
that map, deploy/reconcile selectors, auto-update policy, or promotion closure.

`effectiveStaticGatePolicy(entry)` resolves `gateValidated: true` to
`{presence: "required", image: "showcase-convention"}` and other entries to
`{presence: "optional", image: "ignored"}`. Simultaneous `gateValidated: true`
and `gateIgnore: true` is invalid. Generated entries expose `gateIgnore` and
`gatePolicy`. The six static `showcase-intelligence-*` entries remain permanent,
independently managed services with optional presence, ignored image policy,
unmanaged auto-updates, and disabled probes. Their inventory identity still
requires the exact registered name and `serviceId`. Existing staging `:latest`
and production exact-repository digest rules remain unchanged.

## Presence and exclusions

| Phase or condition          | Absent service in a completely observed environment  | Present owned service                                          |
| --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| Unexpired `setup`           | Allowed, including partial setup                     | Must match expected pin                                        |
| Unexpired `ready`           | `ready-service-missing` failure                      | Must match expected pin; health is not inspected               |
| Unexpired `teardown`        | Expected                                             | Must match expected pin                                        |
| `complete` or `interrupted` | No missing-service failure                           | `leftover-service` failure; image still checked                |
| Expired                     | `setup-expired` for setup; ready absence still fails | `leftover-service`; expired setup also reports `setup-expired` |

Ownership matches the full project, environment, service ID, and corroborating
service name. The same service ID in another environment receives no exemption.
An unknown service in a recorded environment remains unknown and fails the image
gate. A present unhealthy service is still present; PNI-605 must establish
readiness before publishing `ready`.

Lifecycle failures and exclusions are separate outputs. An owned service with a
wrong image or leftover finding stays excluded from permanent promotion and
discovery, while the image gate reports failure. A missing ready service does not
become an unrelated permanent fleet parity failure. Invalid evidence never gives
exclusions. No classification or record grants permission to delete anything.

Only put environments with a complete service inventory in
`observedEnvironmentIds`. The image gate observes registered and recorded
environments project-wide; Ruby promotion observes staging and production; the
harness observes only its configured environment. A query for one environment
cannot report a service in another as missing.

Service inventory cannot certify that volumes, environments, or other resources
were removed. Nonempty `resources` yields `non-service-presence-unverified`.
PNI-605 must verify cleanup against the provider separately.

## TypeScript handoff

Import these source modules from repository tooling; no public npm export is
added. The example paths below assume a file in `showcase/scripts/`:

```ts
import {
  classifyRailwayInventory,
  parseRailwayLifecyclePolicy,
  parseRunRecordsSnapshot,
} from "../harness/src/shared/railway-lifecycle";
import { readRailwayLifecycleEvidence } from "../harness/src/shared/railway-lifecycle-records";
import { DISPOSABLE_LIFECYCLE_POLICY } from "./railway-envs";

const now = new Date();
const policy = parseRailwayLifecyclePolicy(DISPOSABLE_LIFECYCLE_POLICY);
if (!policy.ok) throw new Error(policy.issues.map((i) => i.code).join(", "));

// PNI-605 validates its next complete snapshot before atomic publication.
const next = parseRunRecordsSnapshot(
  { schemaVersion: 1, runs: [] },
  policy.value,
  now,
);
if (!next.ok) throw new Error(next.issues.map((i) => i.code).join(", "));

const evidence = await readRailwayLifecycleEvidence(
  process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE,
  policy.value,
  now,
);
const result = classifyRailwayInventory({
  policy: policy.value,
  evidence,
  now,
  projectId: policy.value.projectId,
  observedEnvironmentIds: [], // No environment inventory was queried here.
  services: [],
});
console.log(result);
```

Both parsers return `{ok: true, value}` or `{ok: false, issues}`. The asynchronous
reader accepts `(filePath: string | undefined, policy, now, signal?: AbortSignal)`
and returns `{status: "unavailable"}`, `{status: "valid", snapshot}`, or
`{status: "invalid", issues}`. Cancellation propagates an abort error.

The classifier accepts `{policy, evidence, now, projectId,
observedEnvironmentIds, services}`. Each observation is exactly
`{name, serviceId, environmentId, image: string | null}`. Its result contains
`services` with `classification: "permanent" | "owned-disposable" | "unknown"`
and optional `runId`, plus `diagnostics`, `failures`, `excludedServices`, and
`excludedEnvironments`. Issues contain `code`, `message`, and optional `runId`,
`serviceId`, `environmentId`. Service exclusions contain
`{projectId, environmentId, serviceId}`. Environment entries contain
`{projectId, environmentId}` for reporting only; never skip an entire environment.

## Offline CLI check

Run from the repository root after installing workspace dependencies. This writes
only a temporary empty snapshot and sends an empty fixture inventory to the
read-only CLI; it needs no credentials and makes no provider calls:

```sh
fixture_dir=$(mktemp -d)
printf '%s\n' '{"schemaVersion":1,"runs":[]}' > "$fixture_dir/runs.json"
printf '%s\n' '{"projectId":"6f8c6bff-a80d-4f8f-b78d-50b32bcf4479","observedEnvironmentIds":[],"services":[]}' |
  SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE="$fixture_dir/runs.json" \
  pnpm exec tsx showcase/scripts/classify-railway-lifecycle.ts
```

Expect all five result arrays to be empty. The real project ID selects committed
policy; this fixture makes no claim about live inventory. To exercise unknown
ownership, use a fictitious environment ID in `observedEnvironmentIds` and a
service with fictitious `name`, `serviceId`, that `environmentId`, and `image: null`.
Expect `unknown-service` and no service exclusions. Do not add fake approved pins.

The CLI accepts JSON on stdin and the record path from the environment; it has no
policy or approval override flag. A valid classification prints JSON and exits
0 even when `failures` is nonempty; consumers must inspect that array. Invalid
input or configured evidence prints a diagnostic to stderr and exits 1.

## Runtime wiring and handoff limits

Ruby `promote` invokes the shared CLI via `Open3.capture3` with argv and minimal
inventory only. With configured evidence, it requires repository-local
`node_modules/.bin/tsx`, Node, and the classifier source. It checks the five root
arrays, service inventory fields and classifications, exact exclusions against
owned services, and diagnostic code/message strings. Missing tooling, subprocess
failure, invalid JSON, or output that fails these checks refuses promotion before
mutation. Optional reporting metadata and `excludedEnvironments` entries are
ignored rather than schema-validated. Unset evidence adds no lifecycle subprocess
dependency. Verified owned services leave both fleet and target snapshots before
promotion checks; direct disposable targets refuse. Lifecycle findings print separately; unknown services stay
visible and cannot enter the selected mutation set.

Harness discovery reads the record path from `ctx.env`, with
`RAILWAY_PROJECT_ID` and `RAILWAY_ENVIRONMENT_ID`. With `NODE_ENV=production`,
it reads the packaged `/app/data/railway-envs.generated.json`; source runs use
[`railway-envs.generated.json`](./railway-envs.generated.json). Mount the durable
record directory read-only and set the variable to its in-container JSON path.
Configured policy or evidence errors raise `DiscoverySourceSchemaError`.
Classification runs before name filters or service-variable reads. Local
injection with configured evidence must supply exact service/environment IDs;
ordinary local injection still needs no Railway credentials or policy file.

With `SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE` configured, discovery and fleet
catalog enumeration require current evidence and cannot use cached fallback,
including when inventory fails before evidence can be read. Successful filtered
results are not cached. Removing the setting does not make previously filtered
results eligible for fallback. Ordinary unconfigured discovery keeps its existing
cache fallback.

[Draft #7710's lifecycle contract](https://github.com/CopilotKit/CopilotKit/blob/fa1dbea07ed360b4f400ab4ef49ac9f3431eec3a/tools/intelligence-smoke/rich-threads/lifecycle/README.md)
implements Docker development only, with Docker IDs, labels, checkpoints, and
provider-specific recovery checks. Its receipts are not Railway ownership
records, and the draft has no hosted Railway provider. PNI-605 must supply that
provider, reviewed real image pins, readiness and cleanup evidence, and the
atomic writer before hosted use. PNI-606 must supply the four-hour schedule.
Offline classifier tests and Docker receipts do not prove Railway deployment or
live probe acceptance.
