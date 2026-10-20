# Update the staging test runner

1. Edit the row1 scenario or assertions and build an immutable runner image with
   `intelligence-rich-threads-build.yml`.
2. Generate the next release from the build run and an explicit prior deployment
   run:

   ```sh
   node tools/railway-runner-deploy/release.mjs \
     --build-run BUILD_RUN_ID \
     --baseline-run VERIFIED_DEPLOY_RUN_ID \
     --output tools/railway-runner-deploy/releases/staging.json
   ```

3. Review and merge the generated release record. Its baseline is the previous
   receipt's verified running image, including a verified rollback. The candidate
   source revision need not be on `main`.
4. Dispatch `intelligence-rich-threads-deploy.yml` from `main`.
5. Inspect the retained `runner-deployment-receipt-ATTEMPT` artifact. Invoke tests
   through `intelligence-rich-threads.yml` after the deployment reports a verified
   running state.

The generator uses `GITHUB_TOKEN`, `GH_TOKEN`, or local `gh auth` for read access.
It needs no Railway, runner, SSH, or 1Password credential. It replaces the named
output only after validation. Expired build artifacts require a new build.
The deployment workflow holds the existing Railway and runner credentials only
in its deployment step. It never checks out or runs candidate code there.

An initial reviewed bootstrap can use `--bootstrap-baseline PATH` instead of
`--baseline-run`. That file contains `{ "image": "...@sha256:...",
"runtimeIdentity": { ... } }` obtained from the verified live support image.
A receipt from the exact reviewed bootstrap commit can later be selected with
`--baseline-run ID --bootstrap-deploy-sha REVIEWED_SHA`. This read-only generator
option does not grant permission to deploy a branch.

Only staging project, service, environment, retained volume, and mount IDs in
`contract.mjs` are permitted. Ordinary updates preserve the protocol, cleanup
policy, and every staged runtime file except `scenarios/row1.mjs`, `rows/row1.mjs`,
tests, and Markdown. The invocation CLI is not a staged runtime input.

## Retry and recovery

The workflow keeps a durable drain owner across deployment restarts. Before it
changes the image, it saves the verified drain, baseline deployment, template,
and volume proof in the redacted receipt. It also records candidate and rollback
deployment IDs before polling them. A rerun reads the preceding attempt's artifact, bound to the same workflow
commit, release, and operation. It can follow at most twenty earlier attempts
when newer receipts explicitly record that provider work never started. A receipt
that records provider work without a checkpoint stops that search.
Rerun the same GitHub run to continue a matching unfinished operation. A known failed
candidate may roll back to the recorded compatible baseline; the workflow still
fails and retains a verified rollback receipt. If the failed candidate cannot
answer HTTP, rollback requires the saved drain proof and an exact recorded
candidate deployment that Railway reports as failed. An unknown deployment ID
still requires the live original drain owner. A reachable runner with a different
owner or template blocks rollback. An unknown outcome, cancellation,
changed owner, or failed rollback keeps admission closed. Never clear that drain
without checking the retained state.

A completed rollback requires a fresh dispatch. A completed same-image operation
also requires a fresh dispatch because the retained operation does not store the
provider deployment ID. Every fresh same-image dispatch performs a real drain and
creates a new deployment. A fresh dispatch using an older release whose distinct
candidate is already active is refused; generate a new release using the last
verified deployment receipt first.

The temporary bootstrap branch exception requires both
`fix/PNI-605-registry-activation` and an exact matching
`RICH_RUNNER_DEPLOY_BOOTSTRAP_SHA` repository variable. Remove that variable after
credential proof. Normal deployment requires `main`. No schedule is enabled.

## Recovery of the October 16 ambiguous create

The optional `--recovery PATH` generator input selects the single incident in
`recovery-contract.mjs`. The release still requires review, immutable build
provenance, and deployment from `main`. It is not a general compatibility bypass.
The old runner first persists a same-image drain fence for the exact failed run.
The controller then sets only `RICH_RECOVERY_AUTHORIZATION_JSON` with deployment
suppressed, and replaces the image on the verified retained volume.

The replacement validates the original intent and lease, retains the original
journal and receipt, and persists ownership of possible late resources before
releasing the old lease. `/deployment/recover` produces `recovery-ready`; resume
requires a fresh inventory check and a durable watch receipt. The original attempt
remains failed and overdue, and `providerFinality` remains `unknown`. Empty CLI
inventory is an observation, not cancellation. The watch continues across runs and
restarts; inventory errors or ambiguous ownership block admission. Scheduling
stays off. Detection can be delayed by outages or an active run.

A failed recovery candidate never rolls back automatically to the legacy image,
which cannot interpret the new metadata. After a lost deploy response, rerun the
same workflow only to adopt a fully verified candidate using its saved checkpoint.
If the old runtime remains or deployment is unresolved, the fence remains closed;
the controller does not issue a second deployment. Future updates while the watch
exists require an explicit compatible recovery transition; ordinary clean-drain
updates cannot certify the unresolved old request as cleaned up.

## Local checks

```sh
pnpm nx run-many -t test,lint --projects=railway-runner-deploy --parallel=1
node tools/railway-runner-deploy/release.mjs \
  --validate tools/railway-runner-deploy/releases/staging.json
```

These JavaScript tools have no build or TypeScript target. Unit tests inject
provider responses; a real staging dispatch supplies the credential and retained
volume proof. Deployment receipts are retained for 90 days.
