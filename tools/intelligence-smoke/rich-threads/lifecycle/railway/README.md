# Disposable Railway provider — PNI-605

Hosting is decided: isolated Railway, serialized runs, maximum **60 minutes including cleanup**. This implements [Mark's handoff](https://linear.app/copilotkit/issue/PNI-605#comment-92bcc046-1a4a-406f-b837-4a2f6d2e3720) against the [PNI-607 contract](https://github.com/CopilotKit/CopilotKit/pull/7734), revision `182997bd315868065610298014cf8cf73da6217d`. It imports the original policy/parser and proof publisher from commit `6414d02de6`; it does not approve images or deploy consumers.

**Not live acceptance evidence.** The committed approval list is empty. No resources were provisioned by this change. Offline controls cannot prove Railway deletion permissions, readiness, persistence, or complete two-framework acceptance.

## Consolidation milestone

The agreed 2026-10-12 delivery sequence narrows the next merge boundary to PNI-605 infrastructure plus a bounded row1 journey on Mastra and Strands TypeScript, assembled by PNI-596 in PR #7709. PNI-607 is merged; deployed reader activation remains an operational prerequisite. Rows2–6, expanded row1 coverage and the Docker development provider are preserved for follow-up work, not this milestone’s acceptance. `preservation.json` records every source file and commit carried or deferred. The original #7710 head remains on `chore/preserve-pni600-pni605-20261012`; only the integration owner closes #7710 after verifying transfer.

## Entry and authority

The common `lifecycle/environment.mjs` dispatches `createEnvironment({config,runId,frameworks,outputDir,signal})` to this provider. Recovery is `recoverEnvironment({receiptPath,config})`, using the durable authority journal rather than trusting IDs from the copied receipt. Enable `tsx` to load the original TypeScript policy/publisher.

Run on **one operator-owned durable controller host**, outside disposable environments. CI must invoke that host; runner-local directories do not provide serialization across hosts. The authority directory and record file must survive worker/container replacement. Initialize the record file explicitly with the proof publisher. Never infer an empty snapshot from a missing file.

The supervisor owns the worker process, stops it at 50 minutes, and invokes reconciliation after worker exit, failure, or cancellation. The provider starts teardown by 55 minutes and refuses successful completion beyond 60 minutes. It checks its parent's private supervisor capability before provisioning and each subsequent operation. Invoke the actual Node worker directly as the supervisor child (a shell/Nx intermediary would change parent identity):

```sh
node --import tsx tools/intelligence-smoke/rich-threads/lifecycle/railway/supervisor.mjs \
  run /operator/private/railway-config.json -- \
  node --import tsx tools/intelligence-smoke/rich-threads/run.mjs <common-runner-arguments>
```

A host outage or SIGKILL of the supervisor requires external restart/recovery on the durable host. **Provisioning must not be activated until that host's service manager/recovery ownership is reviewed and installed.** This PR does not install a service or enable a schedule. On recovery, run:

```sh
node --import tsx tools/intelligence-smoke/rich-threads/lifecycle/railway/supervisor.mjs \
  recover /operator/private/railway-config.json
```

Recovery refuses a live original controller or supervisor. A crashed recovery retains `recovery-lock` with its PID/token; the next explicit recovery checks that process is absent and atomically archives the old lock before acquiring its own. A live or unidentifiable owner still blocks recovery. Unknown provider outcomes, ambiguous IDs, inventory truncation, distribution failure, cleanup refusal, and lifetime violations retain ownership and block future runs. Never clear a lease merely because its time elapsed. Provider outages cannot be turned into proof of absence.

## Private configuration

- `provider: "railway"`, `purpose: "acceptance"`, `projectId` exactly from the committed policy; `controlDirectory`, `recordsFile` absolute owned durable paths.
- `registryActivation: {review, revision}` records the external consumer activation review. It is not an approval override. Actual consumer activation is independently required before the first create; every phase publication verifies current authoritative bytes and matching policy/transport activation.
- `consumers`: each `{consumer: "image-gate" | "ruby-promotion" | "harness", host, receiver, recordsFile}`; all actual reader installations must be included, including additional copies of a role.
- `services`: `{key, roles, framework?, image, env?, volume?:{mountPath}, healthchecks, startCommand?, preDeployCommand?}`. All images must already be independently approved in PNI-607. Roles: `inspection-worker`, `database`, `cache`, `intelligence-api`, `intelligence-gateway`, `application-runtime`, `native-backend`, `application`. API and gateway may share one composite service. Every role needs readiness. The worker uses `{role:"inspection-worker",kind:"worker"}`. PostgreSQL uses `{role:"database",kind:"postgres"}`, Redis uses `{role:"cache",kind:"redis"}`; HTTP uses `{role,port,path}`. Native images require Node 24's built-in SQLite reader. Data services require their own volumes. Service ordering is dependency order. Composite migrations run through its image/startup or `preDeployCommand` before readiness.
- `env` values may use `{{service:<key>:host}}`, resolved to that run's owned Railway private hostname. Secret values remain in memory/private API input files; they never enter journal/snapshot/evidence. Configure actual image-required database/Redis variables; the inspection worker probes the owned private PostgreSQL and Redis connections.
- `database: {serviceKey,user,password,database}` supplies the worker's private connection. Public database TCP proxies and external `scope.databaseUrl` values are refused.
- `inspection: {runnerUrl,token}` binds the worker to the permanent HTTPS authority and a fresh random attempt token. `createTemplate` requires an approved `images.inspector` digest and `licenseCredential`; `materialize` generates the token. Native helpers listen on private port 9191, with no public domain.
- `scopes` retains common logical organization/project/key and native adapter identities. The provider overwrites API/gateway/runtime/application URLs with its owned domain endpoints and `capture.url` with the owned runtime capture endpoint. `scope.native.remote` supplies provider service ID, volume ID, and mount path. A local native path is not a remote reader; row2/common must consume the remote boundary.
- `bootstrapTables` and `nativeBootstrapTables` are explicit count/reason exceptions; conversation, resource, memory, queue, media, and related data cannot be exempted.

The provider verifies a new empty source environment, then a fork whose source is exactly that environment. Railway's schema states `serviceCreate.environmentId` is environment-only for **forks**; nonfork creation can affect all nonfork environments. No service creation is allowed before both isolation checks. Both returned environment IDs are retained and deleted.

## Publication and consumer activation

The hosted runner uses HTTPS registry distribution; its validation rejects the legacy SSH adapter. The legacy adapter remains available only to separately configured external controller hosts. For that adapter, deploy `receiver.mjs` beside each real consumer, with its service environment containing both `SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE` and `SHOWCASE_REGISTRY_CONSUMER`. The former must be the **same file used by the actual image gate, Ruby promotion bridge, or harness**. The SSH request cannot set either value. Receiver Node/tsx, policy revision, known host keys and receiver path must be installed in advance. Initialize each durable file explicitly with the original publisher.

Each transfer validates the whole snapshot with the real parser, checks the exact policy and byte digests, retains previous runs, atomically publishes via the proof publisher, and acknowledges the configured reader path. Missing, stale-policy, malformed or unreadable evidence fails closed. A receiver-only installation does not establish consumer activation: the owner must retain the actual gate/Ruby/harness invocation and configured-path receipts in the activation review. This change neither merges nor deploys those shared consumers.

Creation intents are private durable journal entries before requests. Snapshot IDs originate in provider responses or independently reconciled provider inventory; names never become fabricated provider IDs. `setup`, `ready`, `teardown`, terminal and expired records are retained. Teardown distribution failure does not stop emergency ownership-checked deletion, but completion requires successful final distribution. The classifier is diagnostic only and is never deletion authority.

## Restart, inspection and cleanup

Call `restart(["intelligence-api","intelligence-gateway","application-runtime","native-backend"], framework)` **once for a restart batch**. It selects unique physical services. One composite receipt has `serviceId`, `roles`, `readyRoles`, changed provider deployment-instance IDs and unchanged volume/instance/mount IDs. Do not call the two composite logical roles separately. Scalar calls remain supported for a single requested role.

`verifyCleanScope()` sends fixed operations to one disposable inspection worker after ownership checks. The worker reads every application PostgreSQL table and bootstrap audit in one repeatable-read, read-only transaction, every Redis database through `INFO keyspace`, and both private native scanners. Native scanning includes SQLite WAL state and opaque snapshot/media sidecars. Failed, missing, or incomplete inspection evidence cannot pass. Nothing deletes data to make an inspection pass.

The permanent runner journals jobs and results under the attempt directory. Polling claims a request once; a lost bootstrap result fails the attempt rather than rerunning the write. Requests and replies bind run and request IDs, expire at bounded deadlines, and have size limits. Filesystem locks serialize claims, replies and revocation across the HTTP server and controller process. Worker tokens cannot call admin endpoints; runner tokens cannot use worker endpoints. Cleanup revokes the worker token before deleting resources. The worker has no Railway or runner admin credential.

Cleanup first reconciles outstanding creation intents, verifies exact ownership across all project environments, deletes owned TCP proxies/services/volumes, then both environments. Complete paginated project inventory must show every owned service, volume and environment ID absent. A 200/true delete response alone is insufficient. Restarts do not detach volumes or clear stores.

## Pins and credentials for review

`image-candidates.json` records read-only observed references, independently hashed OCI index/manifest/config digests and available source revision/version labels. None are approvals. Composite/PostgreSQL point to Intelligence `f1d326e8e6924da8186cf1d3d23277cc8bda80de`, version `0.13.9`; Redis is `7.4.3`. Strands is an existing Showcase candidate, not a claim that the custom acceptance/native durability wiring is included. Mastra anonymous package authorization failed. The rich runtime/application and durable native acceptance images still require builds with their source/dependency receipts.

Credential reference found without reading its value: GitHub repository `CopilotKit/CopilotKit`, Actions secret **`RAILWAY_TOKEN`**, metadata updated `2026-04-14T21:55:47Z`. Existing workflows use that reference. The handoff owner must confirm it is the Showcase automation credential Mark verified and bind it to the durable controller. The authenticated local Railway CLI was used only for schema and selected image metadata reads. No secret value was printed or stored.

## Validation

`nx run rich-thread-railway:test` runs provider fault injection, real parser/publisher and three receiver integrations, SQLite/media/Redis/SQL inspection controls, composite-role controls and supervisor process controls. Test approvals are explicitly synthetic in-memory fixtures restored after each test; production has no approval override. The 18 GraphQL documents were also validated against the live read-only Railway schema. These checks supplement, and do not replace, the required real two-framework run and cleanup proof.

### Private canonical bootstrap for the bounded row1 journey

Set `bootstrap` to `{ afterServiceKey: "composite", serviceKey: "postgres", scriptPath: "/private/controller/bootstrap-self-hosted.sh", sourceRevision: "f1d326e8e6924da8186cf1d3d23277cc8bda80de", sha256: "a8c8256ec56a24cb2e494bd8309f6db0fb2ac70c473de1cee2f46e784dbf28b4" }`.
The script must be the canonical Intelligence `app-db-migrations/bootstrap-self-hosted.sh` at that revision, supplied privately by the controller. The controller and worker hash-check its contents before execution and never copied to the journal. The composite image does not include this script.

The owned PostgreSQL service's private `env` contains `BOOTSTRAP_CONFIG_B64`. This contains canonical `organizations` and `localEvaluation` configuration; the caller generates per-run key material. Only the short key and long-key hash belong in the bootstrap configuration. Keep the actual application API key in private application/runtime variables.

Order services as PostgreSQL/cache, inspection worker, composite, then native backends/runtime/application. Database/cache readiness waits until the worker exists. After composite readiness and ownership/volume checks, the provider rechecks PostgreSQL readiness and executes the pinned script. Exactly one committed `CPKI_LOCAL_BOOTSTRAP` identity is required. Later service variables and scope fields can use `{{bootstrap:projectId}}` and `{{bootstrap:organizationId}}`. The journal retains only these validated IDs and source provenance. Bootstrap failure enters the same ownership-checked cleanup as other setup failures.

Declare exact permitted initialization counts in `bootstrapTables`; all other database tables must remain empty. This bootstrap support is locally tested infrastructure, not evidence of a live acceptance run or approved images.

The bounded configuration allows exactly one organization and no access mappings or emergency grants. `cpki.product_audit_events` is never allowed in `bootstrapTables`: its full contents are inspected within the same read-only database transaction as the table counts. Exactly the canonical organization-created and bootstrap-applied records must match the generated organization and configured name/slug, with no actor/project/request/trace metadata and the exact one-organization/no-mappings summary. Additional or altered records fail. Generated audit IDs and timestamps are excluded from content comparison.

Project IDs are positive decimal strings. Use `cpk-{{bootstrap:projectId}}_<short>_<long>` for private runtime variables and `scope.apiKey`; recursive binding resolves the generated ID in both places.

For the deliberate failed-run control only, invoke `supervisor.mjs run <private-config> --expected-worker-exit=1 -- <direct-node-worker-command>`. Supervisor exit zero requires normal worker exit one, no cancellation or timeout, successful recovery, and no remaining active lease. Every other run keeps the default required worker exit zero. The caller must additionally verify its suite receipt identifies the deliberate injected failure and successful cleanup; the supervisor does not infer that from exit status.

## Permanent Railway runner (2026-10-14 decision)

`runner/server.mjs` runs inside one permanent Railway service with one durable
volume mounted at `/data`. It is outside disposable scopes. Persisted runner
service/environment/volume IDs and the actual Railway runtime IDs are forbidden
mutation targets even before registry registration. The permanent service must
also be registered in the shared registry before activating hosted tests.

The runner starts in manual-only mode. Leave `RICH_RUNNER_SCHEDULE_ENABLED`
unset or set it to `false` during setup and hosted acceptance. After acceptance,
set it to `true` to run `controller.mjs --mode=single` every four hours. Other
values fail startup. An enabled schedule with no prior run is due on the first
idle tick; a retained overdue schedule is also due immediately.
`GET /status` includes `scheduleEnabled` so callers can distinguish manual mode
from an enabled schedule. Both modes serialize requests and reconcile unfinished
ownership on startup and every 30 seconds while idle. Disabling scheduling does
not disable recovery, cancel an active run, or block authenticated manual runs.
Cleanup failures block new work. Linux ownership
locks include boot ID and process start ticks so PID reuse after container
replacement cannot impersonate an old owner. The supervisor still enforces each
attempt's 50-minute work budget and reserves cleanup time within 60 minutes.
After a provider outage, verified late cleanup records `deadlineExceeded`; it
releases the lease only once exact owned resources are absent. This is a lifetime
failure, never a passing acceptance result.

The permanent Staging service is `showcase-intelligence-test-runner`
(`4922b45b-6981-4559-be2f-fbbca9123323`), instance
`f96bf2d4-f4f0-41b6-a7e9-547f33c38961`. Its registry entry declares only Staging,
with independent image management, no Showcase build/promotion, and no probe.
It was created without an image or deployment; registration is not evidence of
a running controller or hosted acceptance. Before deployment, the shared registry
consumers must use the revision containing this entry. Older registry revisions
will report the new service as unknown. No Production instance is required.

Required private environment: `RICH_TEMPLATE_JSON`, `RICH_RUNNER_TOKEN` (at least
32 characters), a separately verified Railway automation credential, and
`SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN` for registry distribution. The template
uses `/data/control` and `/data/control/records.json`; private materialized
attempts live under `/data/private`, retained evidence under `/data/results`.
The exact canonical bootstrap script must be supplied at the template's private
script path before any run. Do not put credentials into the Docker build context.

`runner/Dockerfile` builds against a staged committed checkout: common
`tools/intelligence-smoke/rich-threads/`, `tools/railway-disposable-proof/`,
`showcase/scripts/railway-envs.ts`, all `showcase/harness/src/shared/railway-lifecycle*`
files, and root `package.json`. It installs the locked browser-driver dependencies,
Node 24, tsx 4.21.0, Railway CLI 5.41.0 for API calls, and Chromium. Build/publish may run on GitHub;
controller, browser, provisioning, and cleanup execute inside Railway.

`Inspector.Dockerfile` builds a separate worker image with locked PostgreSQL and
Redis clients, Bash and psql. Its digest needs independent approval before use.
The worker polls the permanent runner over HTTPS using only its attempt token.
It receives private database/cache/native addresses and the verified bootstrap
seed through private environment variables. It refuses Railway API tokens and
runner admin tokens. The permanent runner retains the Railway API credential
and owns all provisioning, cleanup and recovery. Neither image needs Railway
SSH registration or an SSH seed. Only the permanent runner needs the Railway CLI
for its existing API adapter.

Both native test images contain the Node 24 scanner and a supervised native
entrypoint. The helper scans only the configured owned volume and exits with
the native backend. Restarting a native service starts both processes again.
The template passes `COPILOTKIT_LICENSE_TOKEN` to the composite and disables its
thread-culler service through the pinned image's `S6_STAGE2_HOOK`.

Provide the canonical bootstrap privately through `RICH_BOOTSTRAP_SCRIPT_B64`
(canonical base64, never a committed file or image layer). Startup verifies the
committed source revision and SHA256, then flushes and atomically installs it as
`/data/private/bootstrap-self-hosted.sh` with mode 0600 before scheduling. The
template must use that exact path and provenance. The seed is removed from the
process environment before launching workers. On subsequent starts the seed may
be omitted: the retained owner-only regular file is hash-validated again. Missing,
corrupt, oversized, or incompatible content blocks startup; errors do not print
source bytes. Supplying this private seed remains an operator deployment step.

Admin endpoints require `Authorization: Bearer <RICH_RUNNER_TOKEN>`. `/health` is public. `/inspection/<runId>/poll` and `/inspection/<runId>/result` require that attempt's separate token:

- `POST /runs` with `{ "mode": "single" | "acceptance" | "crash-recovery" }`
  returns 202 with immutable `id`, `statusUrl`, `resultsUrl`; overlap/cleanup block
  returns 409. For crash recovery, optional `crashStage` is `recorded-volume`
  (default) or `ambiguous-create` (after provider response, before ID journal).
- `GET /status` reports scheduling/recovery state. `GET /runs/<id>` reports results.
- `GET /results/<id>/manifest` returns relative paths, byte lengths, SHA256s.
  Downloads are confined to that retained directory, reject symlink escapes, and
  cap each file at 32 MiB.
- `GET /registry` returns the exact atomic #7734 snapshot and policy/content hash
  headers. Consumers configure the existing records-file setting to this HTTPS
  URL, set the records token and their `SHOWCASE_REGISTRY_CONSUMER` role, and fetch
  fresh before every classification. Successful reads acknowledge the exact bytes
  through `POST /consumers/<role>`. Publication independently verifies current
  authoritative bytes and prior actual activation of each configured role at the
  same URL and committed policy. Activation is not proof that a consumer has read
  the latest snapshot; every consumer must fetch and validate fresh bytes on use.
  Transport or policy changes require new activation. Retain real deployment and
  invocation receipts in the external activation review; synthetic acknowledgments
  and merely shipping reader code do not establish operational activation.

Crash-control runs intentionally SIGKILL the permanent runner after a journaled
owned volume or ambiguous service creation. Railway must restart that same
permanent service with its volume attached. Startup reconciliation exports
`recovery.json` before/after ownership and cleanup evidence alongside retained
results. Run both crash stages and inspect actual provider absence. These controls
are implemented; local tests are supplemental and do not claim hosted acceptance.
