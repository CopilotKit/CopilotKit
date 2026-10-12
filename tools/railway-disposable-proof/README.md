# Disposable Railway feasibility proof

This directory owns the bounded feasibility evidence, not the PNI-605 lifecycle
controller, PNI-607 classifier, or PNI-606 suite. No live acceptance is claimed.

Run `pnpm nx run railway-disposable-proof:preflight` from the repository root.
It validates the committed PNI-607 policy and an empty snapshot. Exit 2 means no
images are approved; exit 0 still requires deployed-consumer and provider checks.
It makes no network calls and changes no registry files. The historical October 9
fleet-conflict reproduction remains in commit 95da59abfb; it describes that older
baseline, not PNI-607's implementation.

Run `pnpm nx run railway-disposable-proof:test` for the atomic publisher controls.
`publishSnapshot(path, {initialize: true})` explicitly initializes missing evidence;
`publishSnapshot(path, {run})` appends or updates against the committed parser.
The caller supplies actual provider-returned IDs. The publisher cannot authenticate
their provenance, prove readiness/deletion, or distribute files to remote readers.
It retains terminal/expired runs and previously recorded ownership, validates the
whole snapshot, uses an exclusive writer lock, flushes a private same-directory
temporary file, atomically renames, then syncs the directory. It returns a digest
for future distribution acknowledgments. Callers must treat any failure as fatal,
including failures after rename (the new snapshot may already be visible).

Use an operator-owned private durable directory and read-only directory mounts
for readers, not a mount of the replaced file. A leftover `.lock` after a controller
crash requires operator/recovery inspection; the publisher never steals it. This
short publication lock is not the full-run lease, and a complete record is not proof
that provider resources are absent. PNI-605 must block the next run on unresolved
cleanup, independently of parser acceptance. Creation intent remains separate.
Remote distribution must deliver these exact bytes atomically to every actual
consumer and verify the returned digest before provisioning continues; that transport
is not implemented here. Check classifier `failures` even when its CLI exits zero.

## Resume requirements

1. Obtain the reviewed PNI-607 revision and its `railway-lifecycle.md` contract.
   Publish its operator-controlled atomic snapshot to every applicable consumer
   through `SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE`. A local branch alone cannot
   protect deployed shared discovery or CI gates.
2. Review exact composite, Postgres, Redis, integration/application and optional
   proxy image pins. An image already running in shared Staging is a candidate,
   not automatic approval under the disposable policy.
3. Resolve the exact disposable environment and automation credential reference.
   Keep provider creation intents separate from confirmed returned resource IDs.
   Never adopt a resource by its name. Record all volumes, domains, environments,
   deployments and enabled object storage, not only services.
4. Bind PNI-605's Railway provider and independent recovery worker before creating
   anything. The Docker receipts in PR #7710 are not Railway ownership records.
   The recovery worker needs access to the durable journal outside the test stack.
   An ambiguous create must be reconciled before retry; failed cleanup blocks reuse.
5. Use PNI-606's real Showcase browser/capture and PNI-597 native readers. Preserve
   both framework and Intelligence stores for owned restart; replace all run stores
   before repetition. Do not reuse shared Showcase project keys or conversations.

## Bounded experiment sequence

Serialize A, B and C. Before each, check the journal and provider inventory for
unresolved prior ownership. Persist the run record before the first provider call.
Use a 45-minute test-work cutoff and reserve 15 minutes for export and teardown;
60 minutes is the hard environment limit, not a cleanup grace period. These are
proposed controller budgets, not measured performance.

- A: initialize fresh Postgres/Redis/native stores; verify empty logical scope;
  drive one representative rich journey through the actual Showcase browser;
  retain emitted events and independent reads of both stores; restart owned
  backends on the same stores; reload and continue original identities; export
  evidence; delete owned resources; confirm their absence using provider reads.
- B: repeat with new resources and prove initial logical emptiness independently.
- C: fail after partial provisioning, then exercise a bounded controller termination
  with the independent recovery worker active. Confirm service, volume, domain and
  environment absence. Never equate a successful delete response with absence.

Minimum rich scenario: user/assistant text, an emitted chart tool with exact
arguments/result, named todo state, browser render, follow-up after restart, and
both-store identity/content comparisons. Record all emitted items. This is only
platform feasibility; every applicable category and pending/import path still
belongs to the six-row acceptance suite. Attempt both Mastra and Strands TS;
one successful framework cannot imply the other passed.

Record provider-returned IDs, image/source/package identities, model/fixture
provenance, monotonic phase durations, peak CPU/RAM/storage, usage availability,
browser screenshots/traces, raw events and both-store snapshots. Redact secret
values before export. Preserve controller and cleanup failures in the final verdict.

For the six-row pair and seven-framework future scope, measure complete suites
before estimating capacity. Four-hour scheduling means six opportunities/day;
a one-hour cap is at most six environment-hours/day with serialized runs. It says
nothing about successful suite throughput. Do not multiply a one-turn latency by
row count to claim headroom.
