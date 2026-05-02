# ops -> harness Naming Audit

Audit date: 2026-05-01
Context: showcase-ops was renamed to showcase-harness, but internal code
references still use the old "ops" naming in env vars, API paths, file
names, comments, and UI state values.

---

## Summary

| Category | Count | Should Rename? |
|---|---|---|
| Env var names (build/runtime) | 4 distinct vars | Yes |
| File names (ops-api.ts / ops-api.test.ts) | 2 files | Yes |
| API proxy path (/api/ops/*) | 1 path | Yes |
| CI workflow matrix keys | 1 key | Yes |
| UI tab state value ("ops") | ~20 occurrences | Yes |
| Comments / docstrings | ~30 occurrences | Yes (follow the rename) |
| Test assertions / mocks | ~25 occurrences | Yes (follow the rename) |

---

## Detailed Findings

### 1. Environment Variable Names

#### OPS_BASE_URL (server-side, build-time)
- **showcase/shell-dashboard/Dockerfile:42-43** — `ARG OPS_BASE_URL` / `ENV OPS_BASE_URL=${OPS_BASE_URL}`
- **showcase/shell-dashboard/next.config.ts:21** — `process.env.OPS_BASE_URL`
- **showcase/docker-compose.local.yml:102** — `OPS_BASE_URL: http://localhost:3200`
- **.github/workflows/showcase_build.yml:297-299** — `OPS_BASE_URL=${{ matrix.service.build_args_ops_url }}`
- **Type**: env var name
- **Should rename?**: Yes -> `HARNESS_BASE_URL`. This is the URL of showcase-harness. Railway env var must be updated simultaneously with the code change.

#### NEXT_PUBLIC_OPS_BASE_URL (client-side, optional escape hatch)
- **showcase/shell-dashboard/src/lib/ops-api.ts:152** — `process.env.NEXT_PUBLIC_OPS_BASE_URL`
- **showcase/shell-dashboard/src/lib/ops-api.test.ts:77,103** — test setup/teardown
- **showcase/shell-dashboard/src/hooks/use-probes.integration.test.tsx:39-52** — test setup/teardown
- **Type**: env var name
- **Should rename?**: Yes -> `NEXT_PUBLIC_HARNESS_BASE_URL`. Not set in production (proxy handles it), but code and tests reference it.

#### NEXT_PUBLIC_OPS_TRIGGER_TOKEN (client-side)
- **showcase/shell-dashboard/src/app/page.tsx:54** — `process.env.NEXT_PUBLIC_OPS_TRIGGER_TOKEN`
- **showcase/shell-dashboard/src/lib/ops-api.ts:27** — docstring reference
- **Type**: env var name
- **Should rename?**: Yes -> `NEXT_PUBLIC_HARNESS_TRIGGER_TOKEN`. Railway env var must be updated simultaneously.

#### OPS_TRIGGER_TOKEN (server-side, harness auth)
- **showcase/harness/src/http/auth.ts:61** — `const DEFAULT_ENV_VAR = "OPS_TRIGGER_TOKEN"`
- **showcase/harness/src/http/auth.ts:56,85** — comments
- **showcase/harness/src/http/auth.test.ts:9,45,75-78,177** — test references
- **showcase/harness/src/orchestrator.ts:573-610** — startup logic + error messages
- **showcase/harness/src/orchestrator.test.ts** — ~20 references (env var setup/teardown/assertions)
- **showcase/harness/vitest.config.ts:15** — comment
- **showcase/harness/src/http/probes.ts:57** — comment
- **Type**: env var name
- **Should rename?**: Yes -> `HARNESS_TRIGGER_TOKEN`. This is the auth token for showcase-harness. Railway env var on both harness AND dashboard services must be updated simultaneously.

### 2. File Names

#### ops-api.ts / ops-api.test.ts
- **showcase/shell-dashboard/src/lib/ops-api.ts** — 295-line fetch client module
- **showcase/shell-dashboard/src/lib/ops-api.test.ts** — unit tests for above
- **Type**: file name
- **Should rename?**: Yes -> `harness-api.ts` / `harness-api.test.ts`. Every import path across the codebase must be updated:
  - `showcase/shell-dashboard/src/components/status-detail-panel.test.tsx:17`
  - `showcase/shell-dashboard/src/components/status-runs-list.tsx:21`
  - `showcase/shell-dashboard/src/components/status-tab.tsx:10,20-21`
  - `showcase/shell-dashboard/src/components/status-table.tsx:125`
  - `showcase/shell-dashboard/src/components/status-runs-list.test.tsx:10`
  - `showcase/shell-dashboard/src/hooks/use-probes.test.ts:4,17,20,28`
  - `showcase/shell-dashboard/src/hooks/use-probes.integration.test.tsx:2,9,11,24`
  - `showcase/shell-dashboard/src/hooks/use-probes.ts:3,30`

### 3. API Proxy Path

#### /api/ops/* (Next.js rewrite)
- **showcase/shell-dashboard/next.config.ts:34** — `{ source: "/api/ops/:path*", destination: ... }`
- **showcase/shell-dashboard/src/lib/ops-api.ts:138** — `const FALLBACK_BASE_URL = "/api/ops"`
- **showcase/shell-dashboard/src/lib/ops-api.ts:20-22** — docstring
- **showcase/shell-dashboard/src/lib/ops-api.test.ts:95,99** — test assertion `"/api/ops/probes"`
- **showcase/shell-dashboard/src/hooks/use-probes.integration.test.tsx:57,77,81,134,149** — test assertions
- **Type**: API path
- **Should rename?**: Yes -> `/api/harness/*`. This is an internal proxy path (not exposed to external consumers). The rewrite source path, the fallback constant, and all test assertions must change together.

### 4. CI Workflow Matrix Keys

#### build_args_ops_url
- **.github/workflows/showcase_build.yml:173** — matrix entry key `build_args_ops_url`
- **.github/workflows/showcase_build.yml:296** — conditional check `${{ matrix.service.build_args_ops_url }}`
- **.github/workflows/showcase_build.yml:299** — value reference `${{ matrix.service.build_args_ops_url }}`
- **Type**: CI matrix key name
- **Should rename?**: Yes -> `build_args_harness_url`. Internal to CI, no Railway coordination needed.

### 5. UI Tab State Value

#### "ops" tab identifier
- **showcase/shell-dashboard/src/app/page.tsx:217-271** — `data-testid="tab-ops"`, `setTab("ops")`, `activeTab === "ops"`
- **showcase/shell-dashboard/src/hooks/useOverlays.ts** — ~15 occurrences of `"ops"` as a union member in type `"matrix" | "baseline" | "ops"` and in hash-routing logic
- **showcase/shell-dashboard/src/hooks/__tests__/useOverlays.test.ts:243-328** — test assertions for `"ops"` tab
- **Type**: UI state / hash fragment
- **Should rename?**: Yes -> `"status"` (the tab is labeled "Status" in the UI, and the hash `#status` already maps to `"ops"` via a legacy alias at useOverlays.ts:54). Renaming the internal state to match the user-visible label is cleaner. NOTE: this changes the URL hash fragment from `#ops` to `#status`, which is a minor breaking change for bookmarked URLs, but `#status` already works as a legacy alias.

### 6. Error Messages & Logging Strings

- **showcase/shell-dashboard/src/lib/ops-api.ts:193** — `"ops-api request failed: ..."`
- **showcase/shell-dashboard/src/lib/ops-api.ts:212** — `"ops-api JSON parse failed at ..."`
- **showcase/harness/src/orchestrator.ts:588** — `"OPS_TRIGGER_TOKEN is set but empty ..."`
- **showcase/harness/src/orchestrator.ts:610** — `"OPS_TRIGGER_TOKEN unset ..."`
- **Type**: error/log strings
- **Should rename?**: Yes, these follow the env var and module renames.

### 7. Comments & Docstrings (follow-on)

All of these are documentation that references "ops" naming and should be
updated to match whichever new names are chosen. They are in:

- `showcase/shell-dashboard/next.config.ts` — ~10 lines of comments
- `showcase/shell-dashboard/src/lib/ops-api.ts` — module-level docstring (~28 lines)
- `showcase/shell-dashboard/src/lib/ops-api.test.ts` — test docstring
- `showcase/shell-dashboard/src/components/status-tab.tsx:7-10` — re-export comment
- `showcase/shell-dashboard/src/components/status-table.tsx:125` — inline comment
- `showcase/shell-dashboard/src/hooks/use-probes.test.ts:4` — docstring
- `showcase/shell-dashboard/src/hooks/use-probes.integration.test.tsx:2-11,56` — docstrings + describe block
- `showcase/shell-dashboard/src/hooks/use-probes.ts:3` — docstring
- `showcase/harness/src/orchestrator.ts:573-610` — F1 block comments
- `showcase/harness/src/orchestrator.test.ts:1392-1394,1403` — describe block name + comments
- `showcase/harness/src/http/auth.ts:56,85` — comments
- `showcase/harness/src/http/auth.test.ts:75,177` — comments
- `showcase/harness/src/http/probes.ts:57` — comment
- `showcase/harness/vitest.config.ts:15` — comment
- `showcase/shell-dashboard/src/app/page.tsx:44` — inline comment

---

## Rename Mapping (Proposed)

| Old Name | New Name | Scope |
|---|---|---|
| `OPS_BASE_URL` | `HARNESS_BASE_URL` | Dockerfile ARG/ENV, next.config.ts, docker-compose, CI workflow, Railway env var |
| `NEXT_PUBLIC_OPS_BASE_URL` | `NEXT_PUBLIC_HARNESS_BASE_URL` | ops-api.ts, tests (not set in prod) |
| `NEXT_PUBLIC_OPS_TRIGGER_TOKEN` | `NEXT_PUBLIC_HARNESS_TRIGGER_TOKEN` | page.tsx, Railway env var on shell-dashboard |
| `OPS_TRIGGER_TOKEN` | `HARNESS_TRIGGER_TOKEN` | auth.ts, orchestrator.ts, tests, Railway env var on harness |
| `build_args_ops_url` | `build_args_harness_url` | showcase_build.yml matrix |
| `ops-api.ts` | `harness-api.ts` | file rename + all import paths |
| `ops-api.test.ts` | `harness-api.test.ts` | file rename |
| `/api/ops` | `/api/harness` | next.config.ts rewrite, FALLBACK_BASE_URL, tests |
| `"ops"` (tab state) | `"status"` | useOverlays.ts, page.tsx, tests |
| `"tab-ops"` (testid) | `"tab-status"` | page.tsx |
| `"ops-api request failed"` | `"harness-api request failed"` | ops-api.ts error strings |

---

## Coordination Notes

1. **Railway env vars must be updated simultaneously with deploy.** The
   following Railway services have env vars that must change:
   - `showcase-harness`: `OPS_TRIGGER_TOKEN` -> `HARNESS_TRIGGER_TOKEN`
   - `showcase-shell-dashboard`: `OPS_BASE_URL` -> `HARNESS_BASE_URL`,
     `NEXT_PUBLIC_OPS_TRIGGER_TOKEN` -> `NEXT_PUBLIC_HARNESS_TRIGGER_TOKEN`

2. **Backward compatibility period**: Consider keeping old env var names
   as fallbacks (e.g. `process.env.HARNESS_TRIGGER_TOKEN || process.env.OPS_TRIGGER_TOKEN`)
   during the transition, then removing the fallback in a follow-up.

3. **URL hash `#ops`**: If the tab state is renamed to `"status"`, the
   existing `#status` -> `"ops"` legacy alias in useOverlays.ts should
   become the primary mapping, and `#ops` should become the new legacy
   alias (preserving existing bookmarks).

4. **No external API consumers**: The `/api/ops/*` proxy path is
   browser-internal (same-origin rewrite). No external systems call it
   directly, so the rename is safe.

5. **Test count**: ~45 test assertions reference "ops" naming. All must
   be updated atomically with the code changes.
