# Second incident recovery implementation plan

Goal: replace the blocked runner on its existing volume while preserving both unresolved environment requests and original failed outcomes.

The provider/runtime work is owned by PNI-600. This controller consumes the reviewed runtime authorization contract; it never imports candidate executable code in its credentialed step. The existing first-incident bridge and ordinary deployment remain unchanged.

- [ ] Add fixed-scope scoped deployment-status reads and a single-attempt deploymentRemove operation. Test wrong scope, missing REMOVED evidence, pagination and concurrent deployments.
- [ ] Add an exact second-incident release contract and checkpoint version 3. Bind the deployed baseline, both immutable incident identities, source ownership, retained volume and authenticated workflow provenance. Never bind mutable watch observations as immutable evidence.
- [ ] Implement remove-requested → removed → candidate-requested → candidate-deployed → resume-requested. Persist each mutation intent first. A lost remove response is resolved only by exact `status: REMOVED` readback; raw mutation outcome and scoped removal proof remain separate durable evidence; a lost deploy response can only adopt an exactly verified candidate, never repeat deployment.
- [ ] Verify both durable watches, original failed/overdue outcomes, retained source provenance, closed startup fence and unchanged volume before resume. Keep ambiguous outcomes closed and never roll back automatically.
- [ ] Add interruption/retry and negative evidence tests, wire release validation and dispatch, and document the operator path.
- [ ] Run scoped Nx lint/tests, independent review and pre-push checks. Commit/push logical units. Integrate the tested runtime, build immutable image provenance, and prepare the release PR without merging it.
- [ ] After the reviewed release is merged, deploy through the main workflow and verify actual provider/runtime evidence. Continue single → acceptance → crash recovery only when each required live proof passes.

No environment creation or deployment occurs during implementation. Scheduling stays off and shared Showcase is outside the mutation scope. A durable watch retains cleanup responsibility; it does not establish provider cancellation.
