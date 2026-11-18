/* eslint-disable @typescript-eslint/no-explicit-any -- browser globals and AG-UI payloads are narrowed at assertion sites. */
import type { Page } from "./conversation-runner.js";

export type A2uiFormat = "express" | "direct_json";

export interface A2uiArrival {
  at: number;
  batch: number;
  payload: Record<string, any>;
}
export interface A2uiEvidence {
  newSurfaceCount: number;
  events: A2uiArrival[];
  paints: Array<{ at: number; signature: string; count: number }>;
}

/** Add an explicit format without changing the default URL for existing cells. */
export function withA2uiFormat(url: string, format?: A2uiFormat): string {
  if (!format) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("format", format);
  return parsed.toString();
}

/** Scheduled probes use the page's selected default when no override was passed. */
export async function prepareA2uiEvidence(
  page: Page,
  requested?: A2uiFormat,
): Promise<A2uiFormat | undefined> {
  const selected =
    requested ??
    (await page.evaluate(
      () =>
        (globalThis as any).document.querySelector(
          '[data-testid="a2ui-format"]',
        )?.value,
    ));
  if (selected !== "express" && selected !== "direct_json") return undefined;
  await startA2uiEvidence(page);
  return selected;
}

/** Reset per-turn evidence; old runs and already mounted surfaces cannot count. */
export async function startA2uiEvidence(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as any;
    g.__hk_a2uiProbe?.observer?.disconnect();
    const selector =
      '[data-testid^="declarative-"], [data-testid="a2ui-fixed-card"]';
    const prior = new Set(g.document.querySelectorAll(selector));
    const priorSurfaces = new Set(
      g.document.querySelectorAll("[data-generative-ui-root]"),
    );
    const probe = {
      events: [],
      paints: [],
      batch: 0,
      toolArgsCount: 0,
      observer: null,
      priorSurfaces,
    } as any;
    g.__hk_a2uiProbe = probe;
    let previous = "";
    probe.observer = new g.MutationObserver(() => {
      const nodes = Array.from(g.document.querySelectorAll(selector)) as any[];
      const fresh = nodes.filter((node) => !prior.has(node));
      const signature = fresh
        .map(
          (node) => node.getAttribute("data-testid") + ":" + node.textContent,
        )
        .join("|");
      if (signature && signature !== previous && probe.paints.length < 200) {
        probe.paints.push({
          at: g.performance.now(),
          signature,
          count: fresh.length,
        });
        previous = signature;
      }
    });
    probe.observer.observe(g.document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

const structuralValue = (value: any): any => {
  if (Array.isArray(value)) return value.map(structuralValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, structuralValue(value[key])]),
    );
  }
  return value;
};
const operationsSignature = (event: A2uiArrival): string =>
  JSON.stringify(structuralValue(event.payload.content.operations));

/** The A2UI 1.0 operations of a `generative-ui-surface` snapshot. */
const operationsOf = (event: A2uiArrival): unknown[] =>
  Array.isArray(event.payload.content?.operations)
    ? event.payload.content.operations
    : [];

export function assertA2uiEvidence(
  evidence: A2uiEvidence,
  format: A2uiFormat,
  mode: "stream" | "heal" | "fixed" | "exhaust",
): void {
  const events = evidence.events;
  const starts = events.filter((e) => e.payload.type === "TOOL_CALL_START");
  const generate = starts.filter(
    (e) => e.payload.toolCallName === "generate_a2ui",
  );
  // TOOL_CALL_END closes the argument stream. The matching result marks
  // completion of the asynchronous generation itself.
  const end = events.find(
    (e) =>
      e.payload.type === "TOOL_CALL_RESULT" &&
      generate.some(
        (start) => start.payload.toolCallId === e.payload.toolCallId,
      ),
  );
  const finished = events.find((e) => e.payload.type === "RUN_FINISHED");
  if (!finished)
    throw new Error("a2ui-format: missing browser RUN_FINISHED arrival");
  if (evidence.newSurfaceCount !== (mode === "exhaust" ? 0 : 1))
    throw new Error(
      `a2ui-format: expected ${mode === "exhaust" ? 0 : 1} new final surface; saw ${evidence.newSurfaceCount}`,
    );
  const results = events
    .filter((e) => e.payload.type === "TOOL_CALL_RESULT")
    .map((e) => {
      try {
        return typeof e.payload.content === "string"
          ? JSON.parse(e.payload.content)
          : e.payload.content;
      } catch {
        return null;
      }
    });
  // The runtime converts every A2UI surface to a 1.0 `generative-ui-surface`
  // activity. The v0.9 lifecycle snapshots (building, retrying) and the
  // `inferenceFormat` tag do not reach the browser.
  const snapshots = events.filter(
    (e) =>
      e.payload.type === "ACTIVITY_SNAPSHOT" &&
      e.payload.activityType === "generative-ui-surface",
  );
  if (mode === "fixed") {
    if (!results.some((result) => result?.inferenceFormat === format)) {
      throw new Error(
        `a2ui-format: fixed SDK result did not report inferenceFormat=${format}`,
      );
    }
    if (generate.length)
      throw new Error(
        "a2ui-format: fixed template unexpectedly invoked model generation",
      );
    return;
  }
  if (mode === "exhaust") {
    if (
      !results.some(
        (result) =>
          result?.code === "a2ui_recovery_exhausted" ||
          result?.a2ui_recovery_exhausted ||
          result?.status === "failed",
      )
    ) {
      throw new Error("a2ui-format: missing exhausted SDK result");
    }
    if (snapshots.some((e) => operationsOf(e).length) || evidence.paints.length)
      throw new Error("a2ui-format: exhausted attempt painted a surface");
    // The runtime shows the exhausted recovery as a surface with status
    // "error", no operations, and the agent's error as its rejected entry.
    if (
      !snapshots.some(
        (e) =>
          e.payload.content?.status === "error" &&
          e.payload.content?.rejected?.length,
      )
    )
      throw new Error(
        "a2ui-format: missing error surface for the exhausted recovery",
      );
    return;
  }
  if (format === "direct_json") {
    const structured = starts.some((start) => {
      if (start.payload.toolCallName !== "render_a2ui") return false;
      const args = events
        .filter(
          (e) =>
            e.payload.type === "TOOL_CALL_ARGS" &&
            e.payload.toolCallId === start.payload.toolCallId,
        )
        .map((e) => e.payload.delta ?? "")
        .join("");
      try {
        const parsed = JSON.parse(args);
        return parsed && (parsed.components || parsed.a2ui_operations);
      } catch {
        return false;
      }
    });
    if (!structured)
      throw new Error(
        "a2ui-format: missing structured render_a2ui Direct JSON wire output",
      );
    return;
  }
  const tagged = snapshots.filter((e) => operationsOf(e).length > 0);
  if (!tagged.length)
    throw new Error("a2ui-format: no generative-ui-surface arrived");
  if (generate.length !== 1 || !end)
    throw new Error("a2ui-format: missing unique generate_a2ui lifecycle");
  if (new Set(tagged.map((e) => e.payload.messageId)).size !== 1)
    throw new Error("a2ui-format: unstable surface message identity");
  // A heal is not visible in the 2.0 stream: the runtime consumes the
  // "retrying" snapshot. The healed surface must not end as an error.
  if (snapshots.some((e) => e.payload.content?.status === "error"))
    throw new Error("a2ui-format: the surface ended as an error surface");
  const progressive = tagged.filter((e) => e.at < end.at && e.at < finished.at);
  // The SDK emits full current-state operation snapshots (commonly the
  // same create/components/data triplet), not an append-only operation log.
  // Compare structure, ignoring object key order, while keeping array order.
  const pair = progressive.some((first, i) =>
    progressive
      .slice(i + 1)
      .some(
        (second) =>
          operationsOf(first).length > 0 &&
          operationsOf(second).length > 0 &&
          first.batch < second.batch &&
          first.at < second.at &&
          operationsSignature(first) !== operationsSignature(second),
      ),
  );
  if (!pair)
    throw new Error(
      "a2ui-format: no distinct current-state snapshots arrived before generate_a2ui completion",
    );
  const paints = evidence.paints.filter(
    (paint) => paint.at < end.at && paint.at < finished.at,
  );
  if (new Set(paints.map((paint) => paint.signature)).size < 2) {
    throw new Error(
      "a2ui-format: surface did not progressively update in the DOM before tool completion",
    );
  }
}

export async function checkA2uiEvidence(
  page: Page,
  format: A2uiFormat,
  mode: "stream" | "heal" | "fixed" | "exhaust",
): Promise<void> {
  const evidence = await page.evaluate(() => {
    const probe = (globalThis as any).__hk_a2uiProbe;
    // An error surface has a root with nothing in it but its theme style.
    const roots = Array.from(
      (globalThis as any).document.querySelectorAll(
        "[data-generative-ui-root]",
      ),
    ).filter((root: any) =>
      Array.from(root.children).some((child: any) => child.tagName !== "STYLE"),
    );
    return {
      events: probe?.events ?? [],
      paints: probe?.paints ?? [],
      newSurfaceCount: roots.filter((root) => !probe?.priorSurfaces?.has(root))
        .length,
    };
  });
  console.info(
    "[a2ui-format]",
    JSON.stringify({
      format,
      mode,
      newSurfaceCount: evidence.newSurfaceCount,
      events: evidence.events.map((event: A2uiArrival) => ({
        at: Math.round(event.at),
        batch: event.batch,
        type: event.payload.type,
        tool: event.payload.toolCallName,
        status: event.payload.content?.status,
        operations: event.payload.content?.operations?.length,
      })),
      paints: evidence.paints.map((paint: A2uiEvidence["paints"][number]) => ({
        at: Math.round(paint.at),
        count: paint.count,
      })),
    }),
  );
  assertA2uiEvidence(evidence, format, mode);
}
