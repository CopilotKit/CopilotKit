# showcase-ops

In-cluster observability service for the showcase fleet. Runs on Railway, receives signed webhooks from GitHub Actions, executes cron-driven probes, persists state to PocketBase, classifies state transitions, and delivers alerts to Slack.

Replaces four legacy GitHub Actions cron workflows (`showcase_smoke-monitor`, `showcase_drift-detection`, `showcase_drift-report`, `showcase_redirect-report`) with a single long-lived process that can hold transition state, dedupe, rate-limit, and render rich templates without each tick re-reading GitHub artifacts.

---

# Part 1 — Operate it

This section is for everyone who needs to add an alert rule, rotate a secret, or figure out why something did or didn't fire. You do not need the source tree checked out — only Railway access and the repo's `config/alerts/` YAMLs.

## 1.1 Inspect a running instance

Production URL: `https://showcase-ops-production.up.railway.app`

- **`GET /health`** — JSON: `{status, pb, loop, rules, schedulerJobs}`. `pb:"ok"` means PocketBase reachable; `loop:"ok"` means the scheduler tick has advanced in the last interval; `rules` is the count of successfully compiled YAMLs; `schedulerJobs` is the count of registered cron entries.
- **`GET /metrics`** — Prometheus exposition. Key counters:
  - `showcase_ops_probe_runs{dimension=...}` — per-dimension probe executions
  - `showcase_ops_alert_matches{rule=...}` — rule match count
  - `showcase_ops_alert_sends{target=...}` — successful target deliveries
  - `showcase_ops_rule_reloads` — increments on SIGHUP / file watcher reload
  - `showcase_ops_webhook_rejections{reason=...}` — HMAC and payload-validation failures; `reason` is one of `stale`, `invalid-signature-format`, `invalid-signature`, `missing-signature`, `missing-timestamp`, `invalid-payload`, `unknown`
- **`POST /webhooks/deploy`** — HMAC-signed webhook ingest for `deploy.result` events. Canonical payload: `METHOD|PATH|TS|sha256(body)` with `sha256=<hex>` signature in `X-Ops-Signature`. Path must be the route constant (`/webhooks/deploy`), not `c.req.path`. 300s skew tolerance.
- **Logs** — `railway logs --service showcase-ops` or the Railway dashboard. All lines are structured JSON: `{level, msg, ts, ...fields}`. Grep targets: `alert-engine.bootstrap-suppress` (gate suppressed a send), `writer.failed` (PB persist failed, always re-emits on bus), `suppress.eval-failed` (a suppress DSL expression threw), `rules.reload.failed` (load-time validation rejected a YAML).

## 1.2 Environment variables

All read at boot unless marked otherwise. See `showcase/ops/src/orchestrator.ts`.

**Required in production:**

| Var                             | Meaning                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POCKETBASE_URL`                | Internal PB endpoint (`http://showcase-pocketbase.railway.internal:8090`). Boot refuses to start if unset when `NODE_ENV=production`. |
| `POCKETBASE_SUPERUSER_EMAIL`    | Admin auth for ops to write status rows.                                                                                              |
| `POCKETBASE_SUPERUSER_PASSWORD` | Paired.                                                                                                                               |
| `SHARED_SECRET`                 | Current HMAC secret for `/webhooks/deploy`. 64-hex recommended. Signer side lives in repo secret `SHOWCASE_OPS_SHARED_SECRET`.        |

**Optional:**

| Var                      | Meaning / default                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHARED_SECRET_PREV`     | Accepted during rotation. See `docs/rotation-drill.md`.                                                                                                                            |
| `AIMOCK_URL`             | Public aimock URL for the aimock-wiring probe to compare against. Probe disables itself if unset.                                                                                  |
| `RAILWAY_TOKEN`          | Service token with read scope on the `showcase` project. Required by aimock-wiring probe to query service env vars.                                                                |
| `RAILWAY_PROJECT_ID`     | Paired with token.                                                                                                                                                                 |
| `RAILWAY_ENVIRONMENT_ID` | Paired with token.                                                                                                                                                                 |
| `DASHBOARD_URL`          | Rendered as `{{env.dashboardUrl}}` in Slack link markup. Default `https://dashboard.showcase.copilotkit.ai`.                                                                       |
| `REPO`                   | Rendered as `{{env.repo}}`. Default `CopilotKit/CopilotKit`.                                                                                                                       |
| `S3_BACKUP_BUCKET`       | Enables the nightly PB-backup cron. Bucket must be writable via default AWS credential chain. Init failure emits `internal.backup.init-failed` on the bus but does not block boot. |
| `AWS_REGION`             | Default `us-east-1`.                                                                                                                                                               |
| `LOG_LEVEL`              | `debug` / `info` / `warn` / `error`. Default `info`. Mutable at runtime via SIGHUP after editing `LOG_LEVEL` env.                                                                  |
| `PORT`                   | HTTP listen port. Default `8080`.                                                                                                                                                  |
| `SLACK_WEBHOOK_<ALIAS>`  | One env var per webhook alias referenced by any rule (`SLACK_WEBHOOK_OSS_ALERTS`, etc.). See §1.4.                                                                                 |

**Caller-side (GitHub Actions repo secrets, not this service):**

| Secret                       | Used by                                           |
| ---------------------------- | ------------------------------------------------- |
| `SHOWCASE_OPS_URL`           | `notify-ops` step in `showcase_deploy.yml`.       |
| `SHOWCASE_OPS_SHARED_SECRET` | Same — paired with the service's `SHARED_SECRET`. |

## 1.3 Alert rule YAMLs

Location: `showcase/ops/config/alerts/*.yml`. The loader picks up every `.yml`/`.yaml` file except `_defaults.yml`, merges defaults in, compiles each rule through a Zod schema + structural validators, and hot-reloads on file changes (`chokidar`) or SIGHUP.

### File layout

```
config/alerts/
├── _defaults.yml                        # merged into every rule
├── aimock-wiring-drift.yml              # invariant drift — @oss, weekly cron
├── deploy-result.yml                    # transition rule for deploy webhooks
├── e2e-smoke-failure.yml                # e2e harness red-tick
├── image-drift.yml                      # GHCR tag vs Railway running image
├── pin-drift-weekly.yml                 # showcase starter pin freshness
├── redirect-decommission-monthly.yml    # legacy-host redirect stability
├── smoke-red-tick.yml                   # smoke probe transition rule
└── version-drift-weekly.yml             # showcase package version pins
```

### Rule skeleton

```yaml
id: aimock-wiring-drift
name: "aimock-universal invariant drift"
owner: "@oss"
severity: error # info | warn | error | critical  (default warn)

signal:
  dimension: aimock_wiring # closed enum — see types/index.ts DIMENSIONS
  filter: # optional
    key: "smoke:mastra" # or glob: "smoke:*"
    dimension: smoke # optional narrowing, must be DIMENSIONS member
    slug: "mastra" # optional substring/glob on the key's slug part

triggers: # fires iff any listed trigger resolves true
  - set_drifted # signal-derived (see deriveSignalFlags)
  - red_to_green # state-transition
  - cron_only: # cron expression co-evaluated by the scheduler
      schedule: "0 8 * * 1"

targets:
  - kind: slack_webhook
    webhook: oss_alerts # resolves to env var SLACK_WEBHOOK_OSS_ALERTS

conditions:
  guards: [] # optional: rule only fires when signal matches a guard
  rate_limit:
    window: 15m # parseDuration: Ns/Nm/Nh/Nd. `null` = off.
    perKey: "ruleId:slug" # optional, limits per-dimension-slug
  suppress: # optional DSL, fail-closed on eval error
    when: "signal.unwiredCount < 2 && trigger.set_drifted"
  escalations: [] # optional mention ladder — see _defaults.yml

template: # mustache
  text: |
    :warning: *drift — {{signal.unwiredCount}} bypassing aimock:*
    {{#signal.unwired}}• `{{.}}`
    {{/signal.unwired}}
    <{{{env.dashboardUrl}}}|Dashboard>

on_error: # optional separate template for probeErrored=true ticks
  template:
    text: ":rotating_light: probe errored: `{{signal.probeErrorDesc}}`"

actions: [] # reserved; no-op for now
```

### Triggers (`src/rules/schema.ts`)

State-transition triggers: `green_to_red`, `red_to_green`, `sustained_red`, `sustained_green`, `first`, `stable`, `regressed`, `improved`.

Signal-derived triggers (set in `deriveSignalFlags`): `set_changed`, `set_drifted`, `set_errored`, `gate_skipped`, `cancelled_prebuild`, `cancelled_midmatrix`.

Plus `cron_only: {schedule}` for time-based invariant rules.

A rule fires when **any** listed trigger matches. The matched trigger name is exposed in the template as `{{#trigger.X}}...{{/trigger.X}}`.

### Templates — Mustache safety rules

Rules render via Mustache. The renderer gates triple-brace `{{{path}}}` at rule-load time to prevent injection:

- Triple-brace on `signal.*` is permitted **only** for fields declared in the probe's `*_SLACK_SAFE_FIELDS` export. Adding a new triple-brace-safe probe field requires extending the probe's export list + a rule-loader test.
- Triple-brace on `event.*` is permitted for: `id`, `at`, `runId`, `runUrl`, `jobUrl`.
- Triple-brace on `env.*` is permitted for: `dashboardUrl`, `repo`.
- Anything else — use double-brace `{{path}}` (HTML-escaped). Triple-brace on an un-safelisted path fails `validateTripleBrace` at load and the rule is rejected.

Convention for Slack link markup: `<{{{url}}}|label>` — triple-brace the URL because Mustache would otherwise HTML-escape `&` inside query strings, breaking Slack's link parser.

### Filters

`{{path | filterName}}` or chained: `{{path | stripAnsi | slackEscape | truncateUtf8 2048}}`.

Available filters (`src/render/filters.ts`):

| Filter         | Purpose                                                                               |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------ |
| `stripAnsi`    | Remove ANSI colour escapes.                                                           |
| `truncateUtf8` | Byte-bounded truncation (codepoint-aware). `truncateUtf8 2000` caps at 2000 bytes.    |
| `truncateCsv`  | Comma-separated truncation, drops whole entries. `truncateCsv 500` caps at 500 chars. |
| `slackEscape`  | Escape `&`, `<`, `>` for Slack mrkdwn label context. Does not escape `                | ` — use triple-brace for URLs. |

Unknown filters are rejected at rule-load. Output of a filter can never be re-parsed by Mustache (sentinel-fenced).

### Suppress DSL (`src/alerts/dsl.ts`)

Hand-written recursive-descent parser. No function calls, no member access beyond `x.y` dot notation. Fail-closed on eval error (treated as `true` — alert IS suppressed) and emits `suppress.eval-failed` on the bus so operators can route a watcher rule at it.

Identifier surface exposed in suppress expressions:

- `signal.*` — anything on the probe's signal object
- `trigger.*` — boolean for each matched trigger name
- `state.new`, `state.prev` — one of `green`, `red`, `degraded`, `error`, or `null` if no prior state
- `lastAlertAgeMin` — minutes since this rule last fired for this dedupe key, or `undefined` on first match
- `hasCandidates`, `probeErrored` — signal-derived booleans

Operators: `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!`, literal strings, literal numbers, literal booleans. Validate at rule-load via a dry-run eval; malformed expressions fail the compile.

### Rate limit + escalation

- `rate_limit.window: 15m` — same `(rule, dedupe_key)` doesn't re-fire within the window. `null` disables. Fail-load on any spec that doesn't `parseDuration` cleanly.
- `escalations: [{whenFailCount: N, mention: "@oncall"}, ...]` — ladder keyed on consecutive-failure count. Last-matching-threshold wins (ascending sort), rendered as `{{escalationMention}}`.

### Dedupe

Dedupe key is `alpha-sorted([rule.id, key, trigger1, trigger2, ...])` joined by `:`. A multi-target rule advances dedupe only when **all** targets succeed; a partial failure leaves the key unadvanced so the failing target retries next tick.

## 1.3a Probe configs

Location: `showcase/ops/config/probes/*.yml`. One YAML per probe. Loaded at startup + hot-reloaded via chokidar + SIGHUP, exactly like alert rules (`probes.reloaded` / `probes.reload.failed` emit on the bus on success/error).

A probe config binds a `kind` (driver) to a `schedule` (cron) and a target shape. At each tick the scheduler calls the driver with one input per target; every driver invocation produces one `ProbeResult` which flows through `writer.write()` → `status.changed` → the alert engine. One YAML = one scheduler entry = N target invocations per tick.

### Three YAML shapes

Exactly one of `targets` / `discovery` / `target` is required per config. The loader's Zod schema (`ProbeConfigSchema`) enforces this — a config with zero or more than one of these three fails the load.

**Static targets** — probes with a fixed, operator-authored list of endpoints. Used by `smoke` and `e2e_smoke`:

```yaml
kind: smoke
id: smoke
schedule: "*/15 * * * *"
timeout_ms: 10000
max_concurrency: 6
targets:
  - {
      key: "smoke:mastra",
      url: "https://showcase-mastra-production.up.railway.app/smoke",
    }
  - {
      key: "smoke:agno",
      url: "https://showcase-agno-production.up.railway.app/smoke",
    }
```

**Dynamic discovery** — probes that enumerate targets from an external source (Railway API, pnpm workspace, etc.). Used by `image_drift` and `version_drift`:

```yaml
kind: image_drift
id: image-drift
schedule: "*/15 * * * *"
timeout_ms: 30000
max_concurrency: 4
discovery:
  source: railway-services
  filter:
    namePrefix: "showcase-"
  key_template: "image_drift:${name}"
```

**Single target** — report-style probes whose driver fans out internally across many entities but emits exactly one synthetic ProbeResult. Used by `pin_drift`, `redirect_decommission`, `aimock_wiring`:

```yaml
kind: pin_drift
id: pin-drift-weekly
schedule: "0 10 * * 1"
target:
  key: "pin_drift:overall"
```

### Kind → dimension mapping

Every `kind` resolves to a driver registered in `src/probes/drivers/index.ts`. The driver owns the emitted ProbeResult's `key` prefix, which must match a declared `Dimension` in `src/types/index.ts` (closed enum) so the rule-YAML side can narrow cleanly.

| YAML `kind`             | Driver file                        | Emitted key prefix(es)                 | Shape     |
| ----------------------- | ---------------------------------- | -------------------------------------- | --------- |
| `smoke`                 | `drivers/smoke.ts`                 | `smoke:<slug>` **and** `health:<slug>` | static    |
| `e2e_smoke`             | `drivers/e2e-smoke.ts`             | `e2e_smoke:<suite>`                    | static    |
| `image_drift`           | `drivers/image-drift.ts`           | `image_drift:<service>`                | discovery |
| `version_drift`         | `drivers/version-drift.ts`         | `version_drift:<pkg>`                  | discovery |
| `pin_drift`             | `drivers/pin-drift.ts`             | `pin_drift:overall`                    | single    |
| `redirect_decommission` | `drivers/redirect-decommission.ts` | `redirect_decommission:overall`        | single    |
| `aimock_wiring`         | `drivers/aimock-wiring.ts`         | `aimock_wiring:global`                 | single    |

The `smoke` driver is the only one that emits **two** keys per target invocation: the primary `smoke:<slug>` ProbeResult is the driver's return value (written by the invoker), and the paired `health:<slug>` ProbeResult is side-emitted through `ctx.writer.write()` before returning. One YAML static target = two writer ticks per cycle. See the JSDoc on `smokeDriver` for why the paired emission is a writer side-channel rather than an array return.

### Discovery sources

Registered in `src/probes/discovery/index.ts`. Closed enum — a typo in `discovery.source` fails the load with `probe-loader: <file>: discovery.source 'X' is not registered (registered: …)`.

| Source             | Used by         | Reads                                                                                                                |
| ------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `railway-services` | `image_drift`   | Railway GraphQL `project.services` via `RAILWAY_TOKEN` + `RAILWAY_PROJECT_ID`. Filter by `namePrefix` / `nameRegex`. |
| `pnpm-packages`    | `version_drift` | `pnpm-workspace.yaml` + per-package manifests via `fs`. Filter by `pathPrefix` / `nameGlob`.                         |

A new source is added by implementing the `DiscoverySource` interface (`src/probes/types.ts`), writing ≥95% unit coverage against a fake backend, and registering it in the orchestrator's discovery registry at boot alongside the existing entries.

### Fan-out semantics

One probe tick produces N driver invocations (N = target count, resolved at tick time for discovery configs). Each invocation is bounded independently by `timeout_ms`; concurrency across a single tick is capped at `max_concurrency` (default 1 — set it higher to overlap independent targets). Each invocation writes ≥1 `status.changed` event, and each event independently passes through the alert engine — a multi-target probe with 17 services produces 17 rule evaluations per tick, not one.

`max_concurrency` is a per-tick worker pool. A tick that overruns its own schedule (e.g. 17 services × 30s timeout > 15 min cron window on `max_concurrency=1`) is skipped by Croner's overlap protection rather than queued.

### Hot reload

`chokidar` watches `config/probes/`. Any add / change / unlink re-runs the loader and calls `diffProbeSchedules` — removed configs are `scheduler.unregister`'d (drains in-flight handlers first); added / changed configs are re-registered (ID uses a `probe:` prefix so it never collides with rule-cron `<ruleId>:cron:<idx>` or internal IDs). A load failure emits `probes.reload.failed` on the bus without dropping the running schedule, mirroring rule-loader semantics. SIGHUP forces the same re-read path.

## 1.4 Slack webhook alias convention

A rule declares `webhook: <alias>`. The Slack target resolves it by uppercasing + dash-to-underscore, then reading `SLACK_WEBHOOK_<ALIAS>` from the env.

- Rule: `webhook: oss_alerts` → env: `SLACK_WEBHOOK_OSS_ALERTS`
- Rule: `webhook: eng-alerts` → env: `SLACK_WEBHOOK_ENG_ALERTS`

First resolution per alias per process emits a `slack-webhook.alias-resolved` info log so operators can spot a mismatch. An invalid alias shape (non `[a-z0-9_-]+`) logs `slack-webhook.invalid-alias-shape` and the delivery throws (no silent drop).

## 1.5 Shared-secret rotation

See `showcase/ops/docs/rotation-drill.md` for the full runbook. Summary: stage `SHARED_SECRET_PREV` = current, set `SHARED_SECRET` = new, rotate GitHub Actions secret `SHOWCASE_OPS_SHARED_SECRET`, drop `PREV` after one full CI cycle confirms the new key works.

---

# Part 2 — Build it, run it, extend it

This section is for anyone touching `showcase/ops/src/` or the Dockerfile.

## 2.1 Architecture

```
┌────────────────────┐  signed webhook   ┌──────────────────────────┐
│  GitHub Actions    │──────────────────▶│   /webhooks/deploy       │
│  (showcase_deploy) │                   │   HMAC verify + schema   │
└────────────────────┘                   └────────────┬─────────────┘
                                                      │ DeployResultEvent
                                                      ▼
┌────────────────────────────────────────────────────────────────────┐
│  Event bus (TypedEventBus)  — in-process pub/sub                   │
└────────────────────────────────────────────────────────────────────┘
         ▲                      ▲                        │
         │                      │                        ▼
┌────────┴────────┐   ┌─────────┴──────────┐   ┌────────────────────┐
│  Probes (cron)  │──▶│  Status writer      │   │  Alert engine     │
│  smoke, health  │   │  PB status + history│──▶│  transition →     │
│  image-drift    │   │  keyed mutex        │   │  guards/suppress/ │
│  aimock-wiring  │   │  writer.failed evts │   │  rate-limit →     │
│  pin/version    │   └─────────────────────┘   │  render →         │
│  e2e-smoke      │                             │  sendToTargets    │
└─────────────────┘                             └────────┬──────────┘
                                                         │
                                                         ▼
                                                 ┌───────────────┐
                                                 │ Slack target  │
                                                 │ (retry + HMAC │
                                                 │  alias env)   │
                                                 └───────────────┘

Side channels:  metrics (Prometheus), /health, logger, S3 backup cron
Storage:        PocketBase (status, status_history, alert_state)
```

Core invariants:

- **Single-writer per status key.** `status-writer` takes a keyed mutex before reading prior state and persisting; concurrent ticks for the same key serialize. Writer never emits `status.changed` unless the PB write succeeded — no phantom transitions.
- **Fail-closed dispatch, fail-open observation.** Suppress DSL eval error → suppress (don't spam Slack). Prior-state PB read error → fall open (still fire the alert so operators see the probe).
- **Dedupe holds on partial failure.** Multi-target rule with one failing webhook does not advance dedupe for that target — it'll retry next tick.
- **Bootstrap window.** First 15 minutes post-boot suppress bare `first` reds/degraded (cold-start noise). Transition-bearing triggers (`green_to_red`, `set_drifted`, etc.) fire normally.

## 2.2 Code layout

```
src/
├── orchestrator.ts           # boot(): wire all components, own lifecycle
├── cli.ts                    # (not present — orchestrator is the entrypoint)
├── logger.ts                 # structured JSON logger, SIGHUP-reloadable level
├── types/index.ts            # Dimension enum, State, Transition, Severity
├── http/
│   ├── server.ts             # Hono server, /health /metrics /webhooks
│   ├── hmac.ts               # canonical payload + timing-safe verify
│   ├── metrics.ts            # typed counter registry
│   └── webhooks/deploy.ts    # signed-deploy ingest + dedupe LRU
├── events/
│   ├── event-bus.ts          # TypedEventBus + BusEvents union
│   └── transition-detector.ts # 16-cell state-machine table
├── probes/
│   ├── types.ts                  # ProbeDriver / DiscoverySource / registry interfaces
│   ├── deploy-result.ts          # webhook deploy-event → ProbeResult mapper
│   ├── smoke.ts                  # legacy smoke probe (deriveHealthUrl + SMOKE_SLACK_SAFE_FIELDS)
│   ├── pin-drift.ts              # pinDriftProbe state-machine authority
│   ├── aimock-wiring.ts          # aimockWiringProbe (used by driver + legacy cron resolver)
│   ├── redirect-decommission.ts  # legacy probe + REDIRECT_DECOMMISSION_SLACK_SAFE_FIELDS
│   ├── drivers/                  # YAML-driven ProbeDriver implementations (one per kind)
│   ├── discovery/                # DiscoverySource implementations (railway-services, pnpm-packages)
│   └── loader/                   # probe-loader + probe-invoker + ProbeConfigSchema
├── rules/
│   ├── schema.ts             # Zod schema + TriggerEnum + DimensionEnum
│   └── rule-loader.ts        # compile + chokidar watcher + bus emission
├── render/
│   ├── renderer.ts           # two-phase Mustache + sentinel fence
│   ├── filters.ts            # FILTER_NAMES tuple + implementations
│   └── filter-regex.ts       # shared filter-path regex
├── alerts/
│   ├── dsl.ts                # parseDuration, evalSuppress
│   └── alert-engine.ts       # dispatch, buildContext, resolveTriggers
├── writers/
│   └── status-writer.ts      # keyed-mutex PB writer, errorInfo classifier
├── targets/
│   └── slack-webhook.ts      # retry + Retry-After + alias env resolution
├── storage/
│   ├── pb-client.ts          # retry-budget HTTP wrapper
│   ├── alert-state-store.ts  # dedupe state with TOCTOU retry
│   └── s3-backup.ts          # optional nightly PB backup
└── scheduler/
    └── scheduler.ts          # cron registry, drain, overlap-skip
```

`docs/rotation-drill.md` — secret rotation runbook (§1.5).

`config/alerts/` — alert rule YAMLs (§1.3).

## 2.3 Local dev

```bash
cd showcase/ops
pnpm install --filter @copilotkit/showcase-ops
pnpm dev                 # tsx watch src/orchestrator.ts

# Or just run the built artifact:
pnpm build && pnpm start
```

Needs a running PocketBase. For local iteration, either `pnpm --filter showcase-pocketbase dev` in `showcase/pocketbase/` or point `POCKETBASE_URL` at any PB 0.22 instance with the expected collections (see `showcase/pocketbase/pb_migrations/`).

## 2.4 Tests

```bash
pnpm test                # 675 unit tests, <10s
pnpm test:watch
pnpm test:coverage
pnpm test:integration    # config wired but test/integration/ empty today
pnpm test:e2e            # same — test/e2e/ empty
pnpm typecheck           # tsc --noEmit
```

Golden-file tests (renderer, filters): regenerate with `pnpm test:update-goldens`.

All LLM-adjacent targets (none in this service today, but see `aimock`) should use `npx aimock` for deterministic replay — never hand-rolled vi.mock response stubs.

## 2.5 Build + deploy

Production runs a single image on Railway, pulled from `ghcr.io/copilotkit/showcase-ops:latest`.

```bash
# 1) Build + push (amd64 is required — Railway runs x86 hosts)
docker buildx build --platform linux/amd64 --push \
  -f showcase/ops/Dockerfile \
  -t ghcr.io/copilotkit/showcase-ops:latest .

# 2) Trigger a Railway redeploy pinned to the new digest.
#    serviceInstanceDeployV2 forces a fresh snapshot — serviceInstanceRedeploy
#    replays the prior manifest and can re-pull a stale digest.
RW_TOKEN=$(jq -r .user.token ~/.railway/config.json)
curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { serviceInstanceDeployV2(serviceId:\"3a14bfed-0537-4d71-897b-7c593dca161d\", environmentId:\"b14919f4-6417-429f-848d-c6ae2201e04f\") }"}'

# 3) Verify
curl -s https://showcase-ops-production.up.railway.app/health
# {"status":"ok","pb":"ok","loop":"ok","rules":8,"schedulerJobs":3}
```

Railway service/environment IDs above are for the `showcase` project's production environment.

There is no CI workflow that auto-builds showcase-ops. Deploys are manual until a build job lands.

## 2.6 Adding things

**A new probe.** Pick or extend a `kind` in `src/probes/drivers/`. Implement `ProbeDriver<Input, Signal>` with ≥95% test coverage. Register the driver in `orchestrator.ts` (`probeRegistry.register(...)`). Drop a `config/probes/<name>.yml` — one of `targets` / `discovery` / `target` (see §1.3a). Add the dimension to `DIMENSIONS` in `src/types/index.ts` if new. If any `signal.*` field is safe to triple-brace in a template, export it as `<NAME>_SLACK_SAFE_FIELDS` and register it in the renderer's `slackSafeFields` map (orchestrator boot). Reviewer checklist: unit tests cover success + each error branch + timeout; the discovery source (if any) has its own tests with a fake backend at ≥95% coverage; YAML validates against `ProbeConfigSchema` at load (`pnpm typecheck` + `pnpm test` cover both).

**A new alert rule.** Drop a `.yml` under `config/alerts/`. Reload via SIGHUP or edit-in-place (chokidar watches). Load-time validator rejects unknown filters, unsafe triple-brace, unknown trigger names, and malformed durations — fix the load error, the service never ships a broken rule.

**A new trigger name.** Add it to `StringTriggerEnum` in `src/rules/schema.ts` AND make sure `deriveSignalFlags` (or a transition rule) emits it. There's a runtime invariant test (`alert-engine.test.ts`) that asserts the enum and `emptyTriggerFlags()` stay in sync.

**A new target.** Implement the `Target` interface (`send(rendered, config)`). Register the `kind` in `orchestrator.ts` alongside `slack_webhook`. Dedupe logic is per-target in `sendToTargets` — a failing target does not advance dedupe, so retries land on the next tick.

**A new filter.** Add to `FILTER_NAMES` in `src/render/filters.ts` and implement. Rule loader imports `FILTER_NAMES` directly so the known-filter Set can't drift from the union.

**A new dimension.** Extend `DIMENSIONS` in `src/types/index.ts`. Downstream Zod validation and rule loader narrow automatically. Update any `deriveDimension` call-sites that hard-case on specific dimension strings.

## 2.7 Known quirks

- **PocketBase 0.22 auth** — superuser auth uses `/api/admins` (pre-0.23 endpoint); a warn-once log calls this out at boot. Upgrade path: drop the legacy fallback once deployed PB is 0.23+.
- **No integration tests** — `test/integration/` and `test/e2e/` dirs exist but are empty. Unit coverage is dense (675 tests across 37 files) but no test hits a live PB or posts a real Slack webhook end-to-end.
- **No auto-build workflow** — push to main does not produce a new `ghcr.io/copilotkit/showcase-ops:latest`; deploys are manual via §2.5.
- **`/metrics` is unauthenticated** — intentional, gated by Railway private networking. If the service ever moves to a public mesh, add a scraper token.
- **Bootstrap window is 15m and not env-overridable** — shift requires a code change to `AlertEngineDeps.bootstrapWindowMs`.

## 2.8 Related

- `.github/workflows/showcase_deploy.yml` — sender side of the `/webhooks/deploy` handshake. `notify-ops` step signs and POSTs.
- `showcase/pocketbase/` — PB image + migrations. Deployed as `showcase-pocketbase` Railway service.
- `showcase/aimock/` — fixture-based LLM mock. The aimock-wiring probe checks that every showcase package routes through it.
- `showcase/ops/docs/rotation-drill.md` — secret rotation.

## 2.9 Legacy cron workflows — where their logic lives now

The four legacy GitHub Actions cron workflows (`showcase_smoke-monitor`, `showcase_drift-detection`, `showcase_drift-report`, `showcase_redirect-report`) are replaced by in-process probes driven by showcase-ops. Each legacy workflow lane maps to one YAML probe config + one driver in `src/probes/drivers/`:

| Legacy workflow                            | New probe YAML                            | Driver                  | Discovery          |
| ------------------------------------------ | ----------------------------------------- | ----------------------- | ------------------ |
| `showcase_smoke-monitor.yml` (smoke)       | `config/probes/smoke.yml`                 | `smoke`                 | — (static list)    |
| `showcase_smoke-monitor.yml` (image drift) | `config/probes/image-drift.yml`           | `image_drift`           | `railway-services` |
| `showcase_drift-detection.yml` (L1-3)      | `config/probes/e2e-smoke.yml`             | `e2e_smoke`             | —                  |
| `showcase_drift-detection.yml` (L4 daily)  | `config/probes/e2e-smoke-daily.yml`       | `e2e_smoke`             | —                  |
| `showcase_drift-detection.yml` (version)   | `config/probes/version-drift.yml`         | `version_drift`         | `pnpm-packages`    |
| `showcase_drift-report.yml` (pin)          | `config/probes/pin-drift.yml`             | `pin_drift`             | —                  |
| `showcase_redirect-report.yml`             | `config/probes/redirect-decommission.yml` | `redirect_decommission` | —                  |

**Deferred**: the auto-rebuild action from `showcase_smoke-monitor.yml` (automatically rebuild+redeploy on image drift) is NOT wired in this PR. Image drift still alerts via `image-drift.yml`; operators must manually redeploy off that Slack post. A follow-up PR adds a `railway-redeploy` action kind to alert-engine's target registry so the rule itself can close the loop.
