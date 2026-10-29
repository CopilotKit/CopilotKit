# Coordinated application and harness policy transition

This package prepares one staging transition. It does not authorize execution.
Opening a new PR and deploying both remain subject to Ran's review. Never rerun
an uncertain transition, rewrite recovery receipts, or clear the admission fence.

## What changes

The Mastra adapter now loads its input schema from `@ag-ui/core/schemas`, fixing
the observed `undefined.parse` error. The disposable test template changes only
three application image references and two native-backend OpenAI key fields.
The key is resolved once from the runner's existing `OPENAI_API_KEY` reference;
the reference itself is preserved. The two previous template keys differ from
that resolved value. Its validity has **not** been established by an OpenAI call.

The lifecycle policy appends the corrected application digest. It retains every
old approval and all ownership/environment restrictions. The staging harness
must carry the same policy; the controller invokes genuine image-gate, Ruby and
deployed-harness readers before resuming admission. A passing activation proves
policy compatibility, not model success or persistence acceptance.

## Fixed identities

| Component                      | Reviewed identity                                                               |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Project / staging              | `6f8c6bff-a80d-4f8f-b78d-50b32bcf4479` / `8edfef02-ea09-4a20-8689-261f21cc2849` |
| Runner service                 | `4922b45b-6981-4559-be2f-fbbca9123323`                                          |
| Runner baseline deployment     | `27d5bc36-0513-46fa-9d51-d1c14cad47dc`                                          |
| Runner baseline image digest   | `0130216d2378373b0c98f55669ca1c9e0299f0f26e468c39261511e30793b4df`              |
| Runner candidate source        | `f50337ab5e3411953667fd077e2dca14c381ca11`                                      |
| Runner candidate image digest  | `dc57bd8e200627bff7e08462355bd3a523831263d20ff364850f1d92c4d2c2f2`              |
| Runner build / artifact        | `40866670319` / `12894546840`                                                   |
| Corrected application digest   | `5ccbaec60d1faf55333dbdebb2a8043bfbbd967d48adb85d3bc618fd4f02a862`              |
| Application source / build     | `51ccd04cf11a137d19ae7d416bddf6146b51bf96` / `40843670703`                      |
| Baseline policy                | `4ded223bb02ea0cdf7ffed4fb8f78b70fbb50c9f74ae82d34addfc94f712c751`              |
| Target policy                  | `818e0ac6b3bef851f39c44a109cdc529cc98da104aeedce8ac84f66db543ff22`              |
| Baseline template              | `020fbeb669a5a0fa0d3da5f120348770721a2c2f9c4e997bccae01792c6a8020`              |
| Prepared target template       | `57fecf8ec47bc79fb42cf9b30cc6f36d4cfff0d4a7e08bc17ad5516eb8bac731`              |
| Staging harness service        | `3a14bfed-0537-4d71-897b-7c593dca161d`                                          |
| Harness baseline deployment    | `848cff51-2936-48e5-9671-09a7cd6ba552`                                          |
| Harness baseline digest        | `797a40e2f7d7ae1ef5a55210a2e5de407aa831eae9e9fc708a9964c2f4fe970a`              |
| Harness candidate digest       | `6c15509e3740b96e1a381f029c718985289740ddda5e5f7a04087502608e1250`              |
| Harness candidate source       | `db76d5d1c67f3e9a85b8d67c809aa10ae3008d41`                                      |
| Harness build / artifact       | `40900830184` / `12909157491`                                                   |
| Harness baseline config digest | `a44da66a6e3866cf30a0f1d93ddacad9168e344a22fc098aa4e12e53fe8dd3de`              |

The harness candidate digest cannot be invented: it must come from the new
build-only workflow at an exact reviewed source revision. The builder supports
only main and the dedicated preparation branch; execution still requires main. The release preparer
refuses missing pins, failed builds, mismatching artifacts or changed policy.
Only the corrected application image above is approved; other application,
Strands and inspector outputs from the new runner build are not substitutions.

## Preparation and review

1. Review the combined source changes, including runtime commit `f50337ab5e`
   on the existing source PR. Approve a new main PR only after this package is
   accepted; do not automatically open it.
2. The build-only harness workflow on the dedicated preparation branch produces `harness-policy-candidate`. It publishes only a candidate tag,
   never the shared `:latest` tag, and has no Railway deployment credentials.
3. Bind `showcase/scripts/staging-harness-image.json` to that exact built digest.
   The ordinary image gate requires the exact staging environment, service ID,
   service name, repository and image. Harness workers and other staging images
   keep their existing rules. Release provenance rejects a binding mismatch
   before any provider mutation. A missing candidate remains a hard failure.
4. Prepare the nonsecret release using `prepare-application-release.mjs` with
   `--harness-build`, `--template-sha` and `--output`. It verifies GitHub attempt,
   workflow, source manifest, artifact and registry provenance, then creates a
   new file exclusively and prints its SHA-256. `GITHUB_TOKEN` comes from the
   execution environment, never an argument. Re-review if the referenced key,
   source, deployment baseline or resulting template digest changes.
5. Review the exact release JSON and hash before authorizing the coordinated
   workflow. These are the dispatch inputs; neither contains a key. A new build
   or a reviewed release record alone does not authorize a deployment.

## Executable rollout order

The separate application controller preserves the existing browser-only release.
The dedicated workflow permits execution only on main, attempt 1, under the
existing staging deployment concurrency lock.

1. Verify runner/application/harness build provenance, all watch/receipt bindings,
   schedule OFF, idle admission, current provider inventory and volume attachment.
   Verify the full reviewed harness baseline configuration, no staged patch and
   no harness-mounted volume. Variable maps are compared as digests, not logged.
2. Resolve and freeze the target template in memory. Immediately before mutations,
   verify the current baseline and referenced key still match that preparation.
3. Drain the existing runner on its current image. Remove its exact deployment
   once. Require independent `REMOVED`, complete inventory and retained attachment
   proof before installing the target template/authorization with deploys skipped.
4. Set and deploy the exact runner candidate once. Require its target identity,
   template, operation owner, drained phase and unchanged historical evidence.
5. Exclusively persist the harness rollout claim before source mutation. Change
   only harness `source.image`, then verify no unexpected automatic deployment.
   Persist the deploy intent and deploy once. Preserve its networking, replica,
   build, healthcheck and variable configuration. Verify the exact resulting
   deployment and immutable image while the runner remains drained.
6. Invoke the real registry command inside that harness. It verifies its own
   `RAILWAY_DEPLOYMENT_ID` before any registry read/acknowledgment. Run the real
   image-gate and Ruby validation paths. Require all three fresh, matching-policy
   receipts from the authenticated runner endpoint and reverify the candidate.
7. Resume the runner only after all checks pass. Reverify deployed identity,
   template, watches, volume, schedule and reader receipts. Preserve redacted
   runner and harness journals as workflow artifacts.

Ruby validation reads staging and production inventories; it does not promote or
mutate production. No production deployment, broad Showcase build, schedule enable,
environment creation or persistence test is performed by this transition workflow.
The bounded model/persistence acceptance remains a separately reviewed next action.

## Failure, restart and recovery

No automatic rollback is implemented. A policy rollback without the corresponding
template and reader rollback is unsafe because the candidate image would cease to
be approved. Preserve the failed operation for an operation-specific recovery plan.

- Failure before drain leaves services unchanged.
- Failure after drain keeps admission closed. Unknown source/deploy outcomes are
  recorded before the request; neither the helper nor a rerun may resend them.
- Candidate startup preserves the original `private/recovery-template.json` and
  separately stores the immediate baseline under the operation ID. Replay checks
  survive writes of the checkpoint, current template and runtime metadata. Changed
  authorization is rejected even after target metadata has been written.
- Preserve both failed environment watches and the failed volume-create watch,
  original deadlines/journals/receipts, durable runner volume and attachment, and
  all pending provider-deletion records. Empty inventory does not prove finality.
- A failed harness rollout or reader activation leaves the new runner drained.
  Do not fabricate a receipt, restore `:latest`, delete the journal, or manually
  clear the fence to make the workflow pass.
