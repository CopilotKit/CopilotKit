/**
 * D6 — reference snapshot capture helper.
 *
 * Drives one D5 conversation script against the LangGraph-Python
 * showcase (LGP, the reference implementation), captures the SSE
 * stream + relevant DOM, and writes one `ParitySnapshot` JSON file per
 * featureType under `showcase/harness/fixtures/d6-reference/`.
 *
 * The helper is dependency-injected end-to-end so tests can hand in
 * scripted Page / browser / interceptor / runner / writer fakes; no
 * live browser, no real filesystem, no chromium binary required for
 * unit tests. Production callers pass real Playwright + node:fs.
 *
 * Design rules from the D5-D6 spec (Notion 34c3aa38, "D6 / Reference
 * snapshot capture" section):
 *
 *  - One snapshot file per featureType, keyed `<featureType>.json`.
 *  - On any failure (browser launch, navigation, conversation
 *    `failure_turn`), the helper returns `{ status: "failed", reason }`
 *    and does NOT write a partial snapshot — better an absent reference
 *    than a corrupt one.
 *  - Multi-turn conversations are common; the SSE interceptor (B10)
 *    only captures the FIRST matching request, so we attach + stop
 *    PER TURN and aggregate captures across turns. Tool calls
 *    concatenate in arrival order; stream profile averages TTFT and
 *    median-of-median P50 (honest numbers, not best-case — the parity
 *    engine's tolerances are the denominator's percentile, not ours).
 *  - DOM serialization scopes to the chat content area only — header /
 *    sidebar / page chrome are noise that would inflate the diff.
 *  - JSON output is diff-stable: object keys sorted, `domElements`
 *    sorted by `(testId, tag, classes)`. `toolCalls` order is
 *    semantic — we do NOT sort it.
 *
 * Reading list flagged tradeoffs:
 *  - Per-turn interceptor attach: each turn's stream is captured into
 *    its own `SseCapture`, then aggregated. The synthesized
 *    `streamProfile.ttft_ms` is the mean of per-turn TTFTs (excluding
 *    zero-chunk turns); `p50_chunk_ms` is the median of all per-turn
 *    p50 medians (a cheap approximation of "typical inter-chunk
 *    cadence" that's stable across turn count).
 *  - Contract fields union across turns — a field that appears in any
 *    turn lands in the snapshot. Type collisions (same path, two
 *    different JS types across turns) keep the FIRST type seen; the
 *    parity engine treats reference vs captured type mismatches as
 *    contract failures, so being tolerant on the reference side is the
 *    safer default.
 */

import path from "node:path";
import type { DomElement, ParitySnapshot } from "./parity-compare.js";
import type { D5FeatureType, D5Script } from "./d5-registry.js";
import { D5_REGISTRY } from "./d5-registry.js";
import type { SseCapture, SseInterceptorHandle } from "./sse-interceptor.js";
import type { Page as RunnerPage } from "./conversation-runner.js";

/**
 * Page surface this helper depends on. Combines the conversation
 * runner's structural Page (selector / fill / press / evaluate) with
 * the navigation + teardown calls needed for capture (`goto`, `close`).
 * Real `playwright.Page` satisfies this structurally; tests inject
 * scripted fakes.
 */
export interface ReferenceCapturePage extends RunnerPage {
  goto(
    url: string,
    opts?: { waitUntil?: "domcontentloaded" | "networkidle"; timeout?: number },
  ): Promise<unknown>;
  close(): Promise<void>;
}

/** Browser handle returned by the launcher. `close` releases everything. */
export interface ReferenceCaptureBrowserHandle {
  page: ReferenceCapturePage;
  close: () => Promise<void>;
}

export interface ReferenceCaptureContext {
  /** LGP showcase root URL — e.g. `https://langgraph-python.up.railway.app`. */
  baseUrl: string;
  /** Canonical slug for LGP — e.g. `"langgraph-python"`. */
  integrationSlug: string;
  /** Absolute path to `fixtures/d6-reference/`. */
  outputDir: string;
}

export interface ReferenceCaptureResult {
  featureType: D5FeatureType;
  status: "captured" | "skipped" | "failed";
  /** Absolute path to the written snapshot. Present iff `status === "captured"`. */
  snapshotPath?: string;
  /** Human-readable reason. Present on `skipped` / `failed`. */
  reason?: string;
}

/**
 * Heavy-collaborator surface, all injectable so tests can mock without
 * spinning up chromium / hitting the disk / opening a CDP session.
 */
export interface ReferenceCaptureDeps {
  launchBrowser: () => Promise<ReferenceCaptureBrowserHandle>;
  attachSseInterceptor: (
    page: ReferenceCapturePage,
  ) => Promise<SseInterceptorHandle>;
  runConversation: (
    page: ReferenceCapturePage,
    turns: ReturnType<D5Script["buildTurns"]>,
  ) => Promise<{
    turns_completed: number;
    total_turns: number;
    failure_turn?: number;
    error?: string;
    turn_durations_ms: number[];
  }>;
  /**
   * Walk the chat-content area and return the flat `DomElement` list
   * the parity engine consumes. Defaults to `serializeRelevantDom`
   * exported below; injectable so tests can hand in deterministic DOM
   * without scripting `evaluate`.
   */
  serializeDom: (page: ReferenceCapturePage) => Promise<DomElement[]>;
  /**
   * Persist a snapshot. Defaults to `defaultWriteSnapshot` (node:fs).
   * Injected so tests can capture writes in-memory.
   */
  writeSnapshot: (filePath: string, snapshot: ParitySnapshot) => Promise<void>;
  /**
   * Optional clock injection for deterministic logging in tests.
   * Defaults to `Date.now`.
   */
  now?: () => number;
  /**
   * Optional logger for warnings (e.g. DOM-fallback to body). Defaults
   * to a no-op so this helper never spams stdout in tests.
   */
  warn?: (message: string, extra?: Record<string, unknown>) => void;
}

/* ─── Public entry points ─────────────────────────────────────────── */

/**
 * Capture a reference snapshot for a single featureType. See module
 * docstring for the failure-mode contract.
 *
 * Implementation order (load-bearing — tests assert call order):
 *   1. Look up the script in `D5_REGISTRY`. Missing → skipped.
 *   2. Launch browser.
 *   3. Navigate.
 *   4. Build turns.
 *   5. For each turn: attach interceptor, run THAT turn, stop
 *      interceptor → per-turn capture.
 *   6. If conversation failed → return failed (no snapshot).
 *   7. Aggregate captures, serialize DOM, build `ParitySnapshot`.
 *   8. Write snapshot.
 *   9. Always close browser in finally.
 */
export async function captureReferenceForFeature(
  featureType: D5FeatureType,
  ctx: ReferenceCaptureContext,
  deps: ReferenceCaptureDeps,
): Promise<ReferenceCaptureResult> {
  const warn = deps.warn ?? (() => {});

  const script = D5_REGISTRY.get(featureType);
  if (!script) {
    return {
      featureType,
      status: "skipped",
      reason: "no script registered",
    };
  }

  const route = (script.preNavigateRoute ?? defaultRoute)(featureType);
  const url = `${ctx.baseUrl}${route}`;

  let handle: ReferenceCaptureBrowserHandle | undefined;
  try {
    try {
      handle = await deps.launchBrowser();
    } catch (err) {
      return {
        featureType,
        status: "failed",
        reason: `browser launch failed: ${errorMessage(err)}`,
      };
    }
    const page = handle.page;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (err) {
      return {
        featureType,
        status: "failed",
        reason: `navigation failed: ${errorMessage(err)}`,
      };
    }

    const turns = script.buildTurns({
      integrationSlug: ctx.integrationSlug,
      featureType,
      baseUrl: ctx.baseUrl,
    });

    if (turns.length === 0) {
      return {
        featureType,
        status: "failed",
        reason: "script produced zero turns",
      };
    }

    // Per-turn interceptor attach/stop. We run each turn in isolation
    // through `runConversation` (single-turn slice) so the interceptor
    // only sees that turn's `/api/copilotkit/` request. Aggregating
    // across turns is the helper's responsibility, NOT the
    // interceptor's.
    const perTurnCaptures: SseCapture[] = [];
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i]!;
      let interceptor: SseInterceptorHandle;
      try {
        interceptor = await deps.attachSseInterceptor(page);
      } catch (err) {
        return {
          featureType,
          status: "failed",
          reason: `attach interceptor (turn ${i + 1}) failed: ${errorMessage(err)}`,
        };
      }

      const turnResult = await deps.runConversation(page, [turn]);

      let capture: SseCapture;
      try {
        capture = await interceptor.stop();
      } catch (err) {
        return {
          featureType,
          status: "failed",
          reason: `stop interceptor (turn ${i + 1}) failed: ${errorMessage(err)}`,
        };
      }
      perTurnCaptures.push(capture);

      if (turnResult.failure_turn !== undefined) {
        // We slice the conversation per-turn so the interceptor only
        // sees that turn's request. `runConversation` therefore always
        // reports `failure_turn === 1` (its own slice-local index).
        // Translate back to the OUTER 1-based turn index — without
        // this, every per-turn capture failure looks like "turn 1
        // failed" no matter which turn actually failed.
        const outerTurnIndex = i + 1;
        return {
          featureType,
          status: "failed",
          reason: `conversation failed on turn ${outerTurnIndex}: ${
            turnResult.error ?? "unknown error"
          }`,
        };
      }
    }

    let domElements: DomElement[];
    try {
      domElements = await deps.serializeDom(page);
    } catch (err) {
      return {
        featureType,
        status: "failed",
        reason: `DOM serialization failed: ${errorMessage(err)}`,
      };
    }

    const snapshot = buildSnapshot(perTurnCaptures, domElements);
    const snapshotPath = path.join(ctx.outputDir, `${featureType}.json`);

    try {
      await deps.writeSnapshot(snapshotPath, snapshot);
    } catch (err) {
      return {
        featureType,
        status: "failed",
        reason: `write snapshot failed: ${errorMessage(err)}`,
      };
    }

    void warn; // currently unused at this site; reserved for future telemetry
    return { featureType, status: "captured", snapshotPath };
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* swallow — capture result already determined */
      }
    }
  }
}

/**
 * Capture references for every featureType registered in
 * `D5_REGISTRY`. Returns one result per featureType (including
 * `skipped` for any featureType that somehow loses its script between
 * iterations — defensive, not expected).
 *
 * Sequential by design: parallel captures would compete for the LGP
 * showcase's Anthropic quota and produce noisy stream timings. The
 * caller can run captures in their own process pool if they need
 * concurrency.
 */
export async function captureAllReferences(
  ctx: ReferenceCaptureContext,
  deps: ReferenceCaptureDeps,
): Promise<ReferenceCaptureResult[]> {
  // Snapshot the registry keys at start time — registration is
  // load-time side-effect, so the set should be stable, but copying
  // defends against script-loader interleaving.
  const featureTypes = [...D5_REGISTRY.keys()];
  const out: ReferenceCaptureResult[] = [];
  for (const ft of featureTypes) {
    out.push(await captureReferenceForFeature(ft, ctx, deps));
  }
  return out;
}

/* ─── DOM serialization ───────────────────────────────────────────── */

/**
 * Selector cascade for the chat root. Order is load-bearing —
 * canonical CopilotKit testid first, then class-based fallback for
 * showcases that haven't migrated, then a generic ARIA pattern, then
 * `body` as a last-resort with a warning.
 */
export const CHAT_ROOT_SELECTORS = [
  '[data-testid="copilot-chat"]',
  ".copilotkit-chat",
  '[role="main"] [aria-label*="chat" i]',
] as const;

/** Tags that are always interesting even without a CopilotKit class. */
const INTERESTING_TAGS = new Set([
  "svg",
  "button",
  "form",
  "input",
  "textarea",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/**
 * Serialize the relevant DOM subtree to a flat `DomElement` list. The
 * walker runs INSIDE the page (via `page.evaluate`) and returns a
 * fully-marshalled JS array — no DOM references cross the boundary.
 *
 * Selection logic (in-page):
 *   1. Try each selector in `CHAT_ROOT_SELECTORS`. First match wins.
 *   2. If none match, fall back to `body` and set a `__fallback` flag
 *      on the result so the helper can warn from the Node side.
 *   3. Walk the chosen subtree. For every descendant, INCLUDE iff:
 *        - has any class starting with `copilotkit-`, OR
 *        - has a `data-testid` attribute, OR
 *        - tag (lowercase) is in the `INTERESTING_TAGS` set.
 *
 * Children are NOT modelled — the parity engine compares as a flat
 * multiset. Same-shape duplicates are preserved (e.g. multiple
 * `<button>` children) so a count regression still surfaces.
 */
export async function serializeRelevantDom(
  page: ReferenceCapturePage,
  warn?: (message: string, extra?: Record<string, unknown>) => void,
): Promise<DomElement[]> {
  // The selectors + interesting-tag set need to cross the
  // `page.evaluate` boundary. We can't import them inside the closure
  // because evaluate runs in the browser. JSON-encode them as the
  // single-arg... except `evaluate` here is the structural Page's
  // 0-arg form. So we string-template the constants into the closure
  // body via `Function` construction. The package's tsconfig excludes
  // DOM lib, so we type-erase document/element through `unknown`.
  const selectorsList = CHAT_ROOT_SELECTORS.map((s) => JSON.stringify(s)).join(
    ", ",
  );
  const tagsList = [...INTERESTING_TAGS]
    .map((t) => JSON.stringify(t))
    .join(", ");
  const code = `
    (() => {
      const win = globalThis;
      const doc = win.document;
      const selectors = [${selectorsList}];
      const interestingTags = new Set([${tagsList}]);
      let root = null;
      for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (el) { root = el; break; }
      }
      const fallback = !root;
      if (!root) root = doc.body;
      if (!root) return { fallback: true, elements: [] };
      const out = [];
      const walker = doc.createTreeWalker(root, 1 /* NodeFilter.SHOW_ELEMENT */);
      let node = walker.currentNode;
      // The walker starts AT the root; advance to the first descendant
      // before the loop so we don't emit the chat-root container itself.
      node = walker.nextNode();
      while (node) {
        const el = node;
        const tag = String(el.tagName || "").toLowerCase();
        const classListSrc = el.classList ? Array.from(el.classList) : [];
        const classes = classListSrc.map((c) => String(c));
        const hasCkitClass = classes.some((c) => c.indexOf("copilotkit-") === 0);
        const testId = el.getAttribute ? el.getAttribute("data-testid") : null;
        const hasTestId = testId !== null && testId !== "";
        const interesting = interestingTags.has(tag);
        if (hasCkitClass || hasTestId || interesting) {
          const item = { tag, classes };
          if (hasTestId) item.testId = testId;
          out.push(item);
        }
        node = walker.nextNode();
      }
      return { fallback, elements: out };
    })()
  `;

  // The structural Page.evaluate signature is `<R>(fn: () => R)`. We
  // synthesize a function from the code string — same pattern as
  // conversation-runner's type-erased indirection, only this one
  // captures local constants via string interpolation rather than via
  // closure (closures don't survive the evaluate boundary).
  const fn = new Function(`return ${code.trim()};`) as () => {
    fallback: boolean;
    elements: Array<{ tag: string; classes: string[]; testId?: string }>;
  };
  const result = await page.evaluate(fn);

  if (result.fallback && warn) {
    warn("reference-capture.dom-fallback-to-body", {
      reason: "no chat-root selector matched; serialised body subtree",
    });
  }

  return result.elements.map((e): DomElement => {
    const dom: DomElement = { tag: e.tag, classes: [...e.classes] };
    if (typeof e.testId === "string" && e.testId.length > 0) {
      dom.testId = e.testId;
    }
    return dom;
  });
}

/* ─── Snapshot assembly ───────────────────────────────────────────── */

/**
 * Build a `ParitySnapshot` from per-turn captures + the serialized
 * DOM. See module docstring for the aggregation rules.
 *
 * Exported for unit testing in isolation from the I/O / browser
 * surface. The function is total: empty `captures` produces an
 * all-zeros snapshot rather than throwing (callers don't reach this
 * with empty captures today, but the parity engine treats empty
 * snapshots as an axis failure rather than a crash).
 */
export function buildSnapshot(
  captures: SseCapture[],
  domElements: DomElement[],
): ParitySnapshot {
  // Tool calls: concatenate in arrival order across turns. Order
  // matters — the parity engine compares as an ordered sequence.
  const toolCalls: string[] = [];
  for (const cap of captures) {
    for (const name of cap.toolCalls) toolCalls.push(name);
  }

  // Stream profile: synthesize ONE profile from the per-turn captures.
  //   - ttft_ms: mean of per-turn TTFTs, excluding zero-chunk turns.
  //   - p50_chunk_ms: median of per-turn p50_chunk_ms.
  //   - total_chunks: sum across turns.
  const ttftSamples: number[] = [];
  const p50Samples: number[] = [];
  let totalChunks = 0;
  for (const cap of captures) {
    if (cap.streamProfile.total_chunks > 0) {
      ttftSamples.push(cap.streamProfile.ttft_ms);
    }
    if (cap.streamProfile.inter_chunk_ms.length > 0) {
      p50Samples.push(cap.streamProfile.p50_chunk_ms);
    }
    totalChunks += cap.streamProfile.total_chunks;
  }

  const ttftMs = ttftSamples.length === 0 ? 0 : mean(ttftSamples);
  const p50ChunkMs = p50Samples.length === 0 ? 0 : median(p50Samples);

  // Contract shape: union across turns. First-seen type wins on
  // collision (see module docstring).
  const contractShape: Record<string, string> = {};
  for (const cap of captures) {
    for (const [path, type] of Object.entries(cap.contractFields)) {
      if (!(path in contractShape)) contractShape[path] = type;
    }
  }

  // Sort contract keys for diff-stable output.
  const sortedContract: Record<string, string> = {};
  for (const k of Object.keys(contractShape).sort()) {
    sortedContract[k] = contractShape[k]!;
  }

  // DOM elements: per-element classes sorted; element list sorted by
  // (testId, tag, classes) for diff-stable output. We don't sort
  // toolCalls (semantic order).
  const sortedDom = domElements
    .map((e): DomElement => {
      const cloned: DomElement = {
        tag: e.tag,
        classes: [...e.classes].sort(),
      };
      if (e.testId !== undefined) cloned.testId = e.testId;
      return cloned;
    })
    .sort(domElementCompare);

  return {
    domElements: sortedDom,
    toolCalls,
    streamProfile: {
      ttft_ms: ttftMs,
      p50_chunk_ms: p50ChunkMs,
      total_chunks: totalChunks,
    },
    contractShape: sortedContract,
  };
}

/* ─── Default deps (production wiring) ────────────────────────────── */

/**
 * Default snapshot writer — JSON-stringifies (2-space indent) and
 * writes via node:fs/promises. Creates the output directory if it
 * doesn't exist (mkdir -p semantics). Exported for production callers
 * that want to use the default without composing a custom writer.
 */
export async function defaultWriteSnapshot(
  filePath: string,
  snapshot: ParitySnapshot,
): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(snapshot, null, 2) + "\n",
    "utf-8",
  );
}

/* ─── Internal helpers ────────────────────────────────────────────── */

function defaultRoute(featureType: D5FeatureType): string {
  return `/demos/${featureType}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function domElementCompare(a: DomElement, b: DomElement): number {
  const aTid = a.testId ?? "";
  const bTid = b.testId ?? "";
  if (aTid !== bTid) return aTid < bTid ? -1 : 1;
  if (a.tag !== b.tag) return a.tag < b.tag ? -1 : 1;
  const aCls = a.classes.join(",");
  const bCls = b.classes.join(",");
  if (aCls !== bCls) return aCls < bCls ? -1 : 1;
  return 0;
}
