# PNI-596 coordinated application and reader policy preparation

Preparation only. Opening an upstream PR and any rollout require Ran's explicit
review/approval. Do not dispatch workflows, deploy, restart, run models, or post
synthetic consumer acknowledgements as part of preparing this change.

## Exact policy delta

Append only:
`ghcr.io/copilotkit/rich-thread-application@sha256:5ccbaec60d1faf55333dbdebb2a8043bfbbd967d48adb85d3bc618fd4f02a862`

Application build: `40843670703`, source
`51ccd04cf11a137d19ae7d416bddf6146b51bf96` (supplied by the integration owner).

Serialized policy before: `4ded223bb02ea0cdf7ffed4fb8f78b70fbb50c9f74ae82d34addfc94f712c751`.
After: `818e0ac6b3bef851f39c44a109cdc529cc98da104aeedce8ac84f66db543ff22`.
All prior images, ordering, permanent identities and forbidden environments remain.
The generated JSON is the artifact consumed by the shared harness image.

## Affected consumers and resources

Shared harness project `6f8c6bff-a80d-4f8f-b78d-50b32bcf4479`, staging
`8edfef02-ea09-4a20-8689-261f21cc2849`.

- Isolated runner: integration owner supplies its current project/environment/service,
  reviewed runtime/template transition and exact baseline/candidate identities.
  Do not substitute the shared harness project for the isolated runner project.
- Shared staging harness: service `3a14bfed-0537-4d71-897b-7c593dca161d`.
  Read-only observation October 29: deployment
  `848cff51-2936-48e5-9671-09a7cd6ba552`, SUCCESS, image
  `ghcr.io/copilotkit/showcase-harness@sha256:797a40e2f7d7ae1ef5a55210a2e5de407aa831eae9e9fc708a9964c2f4fe970a`.
  Recheck immediately before rollout; this observation is not a future baseline authorization.
- Image gate and Ruby promotion: checked-out source policy must match runner.
  These are workflow readers, not services requiring deployment.
- Inspector does not consume this policy and requires no rebuild for this delta.

## Executable preparation and activation

Use an exact integrated commit containing both policy files and the helper.
Regenerate the policy with the existing emitter and run the focused Nx tests.
Build the harness from repository root using `showcase/harness/Dockerfile`.
It copies `showcase/scripts/railway-envs.generated.json` to
`/app/data/railway-envs.generated.json`. Record the immutable image digest and
source/build provenance; they are unresolved prerequisites, never placeholders
accepted by the controller. Build/publish/rollout are separate approved steps.

The integration controller can import `activateRegistryReaders` from
`showcase/scripts/activate-registry-readers.mjs` after candidate verification and
before resume. Supply exact target policy, registry URL, transition time
`notBefore`, immutable harness image and deployment ID, and read-only adapters:

- `assertCandidateDrained(signal)` must re-read and assert the exact candidate,
  operation ownership and drained state; it runs before activation and before success.
- `readHarnessDeployment(signal)` -> `{ id, image, status }`, from actual staging
  harness latest deployment metadata, not desired configuration or an input echo.
- `readConsumerReceipt(role, signal)` -> authenticated `GET /consumers/<role>`.
  Return missing receipts as null; other provider/auth failures must propagate.

The helper uses existing environment-bound credentials, never prints them, and
executes the real image gate and Ruby registry-only validator. It never runs a
local process claiming to be the harness. The deployed harness must run its one-shot real reader using its bundled policy:
`node dist/validate-registry.js EXPECTED_POLICY_SHA256`.
Supply `activateHarnessReader({ harnessDeploymentId, harnessImage, policySha256, signal })`
to execute that command INSIDE the verified deployment, using its existing environment.
Do not run a local copy or fabricate environment/workflow identities. The command
loads `/app/data/railway-envs.generated.json`, validates its hash, and invokes the
same authenticated reader used by normal discovery. It runs no probes or inventory
queries. Ordinary discovery cron timing does not guarantee activation within120seconds.
The helper bounds awaited activation to at most 120 seconds (child cancellation
is not a process-tree termination guarantee), requires all three receipts to match
policy/URL/reader and the activation time boundary, and rechecks deployed harness
identity. The controller must retain drain on every error and revalidate its own
operation ownership before resume. The helper does not mutate deployment state.

The helper requires the normal GitHub workflow identity variables used by the
Ruby validator. Do not invent workflow identities for a local run.
The real image gate reads project service instances; the existing Ruby validator
reads both staging and production inventories. That read scope must be included
in rollout approval. Neither reader performs a promotion in this path.

## Rollout order for later review

1. Confirm exact baseline, preserve all three watches, journals, failed receipts,
   pending deletion records and permanent `/data` volume. Keep schedule off.
2. Prepare matching harness image and exact runner candidate/release provenance.
   Ordinary same-policy upgrade rules must not be bypassed; use the separately
   reviewed, operation-bound transition owned by PNI-596.
3. Drain runner and apply the reviewed transition. Old readers fail closed during
   policy mismatch. Install the exact matching staging harness image under the
   coordinated approval, with no unrelated service changes.
4. Run the helper using source at the matching policy. Verify actual deployed
   harness identity and all three fresh receipts. Verify watches, cleanup state,
   volume and operation binding before the controller resumes.
5. A successful activation proves reader compatibility only. The model credential
   remains unvalidated by offline preparation; differing key values alone do not
   prove either key is valid. A separately authorized bounded live test is still
   required for acceptance.

## Failure and recovery

Any mismatch, reader failure, timeout or deployment drift leaves admissions
closed. Preserve new and historical receipts and the failed operation. Do not
manually rewrite receipts, rebind a baseline, delete records or retry a mutation
with an unknown outcome. A stale harness can be repaired only through a reviewed
matching-image deployment. Returning to the old policy requires an explicit
operation-aware recovery plan: changing only one component would recreate a
policy mismatch, and the updated template may require the new approved image.

## Proposed combined PR text for owner review

Title: `fix: coordinate Mastra test image and harness policy transition`

Body: The bounded persistence runner needs the corrected Mastra application image
and aligned native model credential configuration. Append that exact application
image to the shared lifecycle policy, package the matching harness policy, and
apply an operation-bound runner/template transition. Before resuming, invoke the
real image-gate and Ruby readers and require a fresh receipt from the exact deployed
harness. Preserve prior approvals, recovery watches and deletion tracking.

Validation: focused offline policy, reader, activation and integration tests;
add exact final test totals and source/image provenance from the combined package.
No live-model acceptance or credential-validity claim is made by these tests.

## Guarded harness rollout controller (preparation only)

`rollout-harness-policy.mjs` exports `rolloutHarnessPolicy`. It fixes the shared
staging harness scope and observed immutable baseline, accepts only an immutable
candidate digest, and requires the full reviewed `baselineConfig` from a live
read immediately before rollout. Source image is the only permitted change.

Read-only observation October29: no mounted volumes; no staged patch; one us-west2
replica; healthcheck `/health`; desired image `showcase-harness:latest` with
`source.autoUpdates.type=disabled`; domain `harness-staging-2ee4.up.railway.app`
(targetPort null); private endpoint `showcase-ops`; historical build setting
`dockerfilePath=showcase/ops/Dockerfile`. Preserve these settings; the future
image itself is built with `showcase/harness/Dockerfile`.

Required provider bindings (integration owner implements exact authenticated API):

- `inspect(scope, signal)` returns exact project/environment/service IDs, LIVE
  serialized config (not staged merged config), full mounted `volumes`, `staged`
  patch or null, and `latestDeployment: {id,image,status}` with immutable image
  from deployment metadata. No variable values are needed.
- `setImage(scope, targetImage, signal)` changes ONLY `source.image` and returns
  true only on confirmed acknowledgement. Never automatically retry.
- `deploy(scope, signal)` sends exactly one deploy and returns its deployment ID.
  Never automatically retry. An automatic deployment observed after source update
  prevents the explicit deploy; retain the receipt for reconciliation.
- `journal.claim(receipt)` must durably and exclusively claim this operation;
  `journal.save(receipt)` must durably replace its receipt before resolving.
  Missing durability or exclusivity violates the adapter contract.
- `assertCandidateDrained(signal)` checks exact runner operation ownership,
  candidate verification and drained admissions before provider reads/mutations.

The receipt precedes each mutation. Any retained incomplete receipt blocks all
further mutations on re-entry, including unknown outcomes. A verified receipt
allows only read-only re-verification. No rollback is automatically attempted.
Awaited operations are bounded; abort does not imply Railway cancelled a request.
The controller returns the exact successful deployment ID for reader activation.
Run it after runner candidate verification/drain, then execute the one-shot reader
inside that deployed harness; do not rely on startup timing or trigger a probe suite.
