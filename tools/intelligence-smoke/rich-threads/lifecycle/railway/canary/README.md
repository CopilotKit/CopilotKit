# PNI-605 isolated service-scope canary

Ran authorized assessing and reusing the existing private project on October 19, 2026. The [existing-project reuse plan](reuse-plan.md) is the applicable variation
for that scope. It retains source A and the original journals, creates only a new
fork and inert service, and requires reviewed inactive-deletion evidence.

For the paced original source-to-fork variation, see [fork-plan.md](fork-plan.md)
and `fork-scope.example.json`. It requires a separately authorized fresh scope;
it does not reuse or retry the previous canary project or its operations.

Purpose: establish current provider behavior for serviceCreate(environmentId) and
serviceInstanceUpdate(environmentId) without creating any instance in Showcase.
Official environment docs and current CLI behavior describe isolated environments;
the GraphQL ServiceCreateInput description still describes non-fork fanout.
Historical fork error text was discarded, so this canary tests a replacement's
isolation property, not the cause of that historical response.

Scope to review: one freshly created dedicated disposable project, exact project
ID and name supplied to the probe. Reject the existing PNI-605/Showcase project,
all protected environment IDs, and any project with existing services or volumes.
Project creation remains a separately reviewed sequencer action. No production
credential source, existing environment, image, repository, variable or model key
is used. The canary has no deploy operation.

1. Persist config, start time, <=10-minute expiration and complete original
   environment/service/volume inventory in a private local journal. Require exact
   configured project identity and fresh creation time. Refuse an existing journal
   on ordinary start; recovery mode performs no create retries.
2. Before each create, persist its exact name/scope/input and complete before IDs.
   Create two empty environments with skipInitialDeploys. Verify returned IDs and
   exact names/project identity against complete inventory and detailed reads.
   Before writing each environment intent, read the project's environment-create
   rate limit and wait a full reported window plus two seconds. The private
   `create-pacing` ledger records the reservation; an interrupted or fresh process
   must wait another full window. This never retries an unresolved request.
3. Create one empty service in environment A with no source/repository/variables.
   Read every environment, including original default environment. Record which
   environment IDs contain the new service. Create isolation passes only if A is
   the sole environment containing it, with no volume or deployment created.
4. Change only the service instance startCommand in A to a fixed inert string.
   Read exact service-instance config in A and every other environment; compare
   all sibling instances to pre-edit values. Edit isolation requires only A's
   command to change. Record both conclusions independently; fanout is a failure.
5. Cleanup only journal-owned service and the two journal-owned environments,
   reverse order, after ownership and inventory checks. Write deletion intent
   first and verify absence with complete inventories even if delete response is
   lost. Never remove original default environment or supplied project implicitly.
6. Final complete inventories must equal baseline; no services, volumes or
   deployments remain. Sequencer separately deletes the disposable project and
   verifies its absence. Report observed isolation and cleanup, never acceptance.

Unknown create/configure outcomes stop further creation and retain the journal;
no retry, no broad adoption by prefix, no claim of finality from absence. Read-only
recovery inspects saved IDs/names and reports the exact unresolved intent. Known
owned cleanup is available only when all create intents have confirmed IDs and no
unresolved mutation remains. Expiration stops new writes except owned cleanup.

596 is sole live sequencer. Run only after exact project scope and script have been
reviewed. Keep schedule off. This probe contains no Mastra/StrandsTS acceptance run.

## Review and invocation

Workspace scope is fixed to `9cab81e9-4aa5-40cd-a484-3a585ca35c90`. The live
sequencer creates the disposable project after scope review, recording the unique
`pni605-canary-<12 hex>` name, before-project IDs, request start time and returned
ID before independent CLI verification. A lost project-create response stops;
name absence does not permit retry. The script itself cannot create/delete projects.
Project creation and deletion require the sequencer's separately journaled action.
The sequencer must also observe the provider's project-create rate limit and
coordinate external writers. A failed probe does not authorize another project
or a new canary request. Preserve its original journal and unresolved outcomes.

Copy `scope.example.json` to private scratch space and replace the project ID/name
with the exact fresh project verified by the sequencer. The placeholder is invalid
by design. Run from the checkout with its installed `tsx` loader:

```sh
node --import tsx tools/intelligence-smoke/rich-threads/lifecycle/railway/canary/cli.mjs run /private/tmp/pni605-canary-journal /private/tmp/pni605-canary-scope.json
node --import tsx tools/intelligence-smoke/rich-threads/lifecycle/railway/canary/cli.mjs inspect /private/tmp/pni605-canary-journal
node --import tsx tools/intelligence-smoke/rich-threads/lifecycle/railway/canary/cli.mjs cleanup /private/tmp/pni605-canary-journal
```

`run` refuses an existing journal directory. `inspect` is read-only. `cleanup`
never retries creates or prior deletes: it can verify an already absent deleted ID,
or delete a confirmed owned resource for the first time. A still-present resource
with a previous deletion intent requires inspection instead of an automatic retry.
The output is a summary; full mutation and inventory evidence stays in the private
journal. No token values are accepted in scope JSON or printed by this tool.

Evidence motivating the probe:

- [Railway environment isolation and deprecated forks](https://docs.railway.com/environments)
- [Official CLI service creation sends the selected environment ID](https://github.com/railwayapp/cli/blob/master/src/commands/add.rs)
- [Official CLI environment duplication implementation](https://github.com/railwayapp/cli/blob/master/src/commands/environment/new.rs)

These sources motivate the test; they do not substitute for its observed result.
