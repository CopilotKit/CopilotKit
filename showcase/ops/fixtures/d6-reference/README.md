# D6 reference snapshots

Per-feature `ParitySnapshot` JSON files captured against the LangGraph-Python (LGP) showcase — the reference implementation the D6 probe compares every other showcase against.

## What lives here

One JSON file per `D5FeatureType`:

```
fixtures/d6-reference/
  agentic-chat.json
  tool-rendering.json
  shared-state-read.json
  shared-state-write.json
  hitl-approve-deny.json
  hitl-text-input.json
  gen-ui-headless.json
  gen-ui-custom.json
  mcp-apps.json
  subagents.json
```

Each file conforms to the `ParitySnapshot` schema in `src/probes/helpers/parity-compare.ts`:

- `domElements` — flat list of relevant chat-content DOM elements (sorted by `testId, tag, classes`).
- `toolCalls` — ordered list of tool-call names emitted on the SSE stream (concatenated across turns).
- `streamProfile` — `{ ttft_ms, p50_chunk_ms, total_chunks }` aggregated across the conversation's turns.
- `contractShape` — field path → JS-type string for the union of every SSE payload observed.

The files are NOT shipped in git in this commit — the `.gitkeep` reserves the directory and the helper writes snapshots at runtime when the LGP showcase is online.

## When to refresh

- **Weekly cron** — the showcase-ops scheduler runs the capture job once a week to pick up upstream LGP runtime/agent drift.
- **Manual trigger** — operators can re-capture on demand:
  - after an LGP showcase redeploy (especially LGP runtime / agent changes),
  - after a D5 fixture update (`fixtures/d5/*.json`) — fixtures drive what the model says, which changes tool calls and contract shape,
  - after a parity-tolerances change in `parity-compare.ts` — re-baseline so previous captures' timing aren't unfairly compared against new bounds,
  - after an ag-ui protocol bump that changes wire-level event names.

If you're unsure whether the snapshots are stale, run the D6 probe — captured-vs-reference drift on the timing axes is a clean signal that the reference is older than the deployment.

## How to invoke

The helper lives at `src/probes/helpers/reference-capture.ts` and exposes two entry points:

```ts
import {
  captureReferenceForFeature,
  captureAllReferences,
} from "./reference-capture.js";

// Capture all 10 featureTypes:
const results = await captureAllReferences(
  {
    baseUrl: "https://langgraph-python.up.railway.app",
    integrationSlug: "langgraph-python",
    outputDir: path.resolve(__dirname, "../../fixtures/d6-reference"),
  },
  {
    launchBrowser: defaultLaunchBrowser,
    attachSseInterceptor, // from sse-interceptor.ts
    runConversation, // from conversation-runner.ts
    serializeDom: serializeRelevantDom,
    writeSnapshot: defaultWriteSnapshot,
  },
);

// Or one feature:
const result = await captureReferenceForFeature("agentic-chat", ctx, deps);
```

Operators capture or refresh snapshots via the CLI wrapper at `showcase/ops/scripts/d6-capture-references.ts`. The script accepts `--integration <slug>` (default `langgraph-python`), `--base-url <url>` (else `LGP_BASE_URL` env), and an optional `--feature <type>` to target a single featureType. Run it from `showcase/ops/`:

```sh
LGP_BASE_URL=https://langgraph-python.up.railway.app \
  npx tsx scripts/d6-capture-references.ts
```

It exits 0 when every result is `captured` or `skipped`, exits 1 when any result is `failed`. Production wiring (driver + scheduler) lands with B13.

## What to verify after capture

1. Every featureType in `D5_REGISTRY` produced a file (no `failed` results in the return array).
2. `streamProfile.total_chunks > 0` on every captured snapshot — a zero-chunk profile means the SSE interceptor missed the stream and the snapshot is unusable.
3. `toolCalls` matches the D5 fixture's expected sequence — if not, either the fixture or the capture is wrong; check `fixtures/d5/<feature>.json` first.
4. Open the JSON file diff — keys should be sorted, `domElements` sorted by `(testId, tag, classes)`, `toolCalls` in arrival order. Diff-stable output is non-negotiable: a noisy diff on re-capture means either non-determinism in the LGP run or a regression in the helper's normalization.

## Failure modes

The helper is fail-closed: any failure (browser launch, navigation, conversation `failure_turn`, DOM serialization, write) returns `{ status: "failed", reason }` WITHOUT writing a partial file. An absent reference is correctly handled by the D6 driver (skips the comparison with a "no reference" note); a corrupt one would silently invalidate the parity verdict for that featureType.

If the capture run reports `failed` for a featureType, do NOT delete the older snapshot in place — leave it until a successful run replaces it atomically.
