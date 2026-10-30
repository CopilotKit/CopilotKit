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

/** Reset per-turn evidence; old runs and already mounted surfaces cannot count. */
export async function startA2uiEvidence(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as any;
    g.__hk_a2uiProbe?.observer?.disconnect();
    const selector =
      '[data-testid^="declarative-"], [data-testid="a2ui-fixed-card"]';
    const prior = new Set(g.document.querySelectorAll(selector));
    const priorSurfaces = new Set(
      g.document.querySelectorAll("[data-surface-id]"),
    );
    const probe = {
      events: [],
      paints: [],
      batch: 0,
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
  JSON.stringify(structuralValue(event.payload.content.a2ui_operations));

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
  const snapshots = events.filter(
    (e) =>
      e.payload.type === "ACTIVITY_SNAPSHOT" &&
      e.payload.activityType === "a2ui-surface",
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
    if (
      snapshots.some((e) => e.payload.content?.a2ui_operations?.length) ||
      evidence.paints.length
    )
      throw new Error("a2ui-format: exhausted attempt painted a surface");
    if (
      format === "express" &&
      !snapshots.some(
        (e) =>
          e.payload.content?.inferenceFormat === "express" &&
          e.payload.content?.status === "failed" &&
          e.payload.content?.errors?.length,
      )
    )
      throw new Error("a2ui-format: missing tagged Express failure activity");
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
    if (
      !structured ||
      snapshots.some((e) => e.payload.content?.inferenceFormat === "express")
    )
      throw new Error(
        "a2ui-format: missing structured render_a2ui Direct JSON wire output",
      );
    return;
  }
  const tagged = snapshots.filter(
    (e) => e.payload.content?.inferenceFormat === format,
  );
  if (!tagged.length)
    throw new Error(
      `a2ui-format: no server surface reported inferenceFormat=${format}`,
    );
  if (generate.length !== 1 || !end)
    throw new Error("a2ui-format: missing unique generate_a2ui lifecycle");
  const id = "a2ui-surface-" + generate[0]!.payload.toolCallId;
  if (tagged.some((e) => e.payload.messageId !== id))
    throw new Error("a2ui-format: unstable surface message identity");
  if (mode === "heal") {
    const retry = tagged.find(
      (e) =>
        e.payload.content?.status === "retrying" &&
        e.payload.content?.errors?.length,
    );
    if (!retry)
      throw new Error(
        "a2ui-format: heal did not report a rejected first attempt",
      );
    if (
      evidence.paints.some((paint) => paint.at < retry.at) ||
      tagged.some(
        (e) => e.at < retry.at && e.payload.content?.a2ui_operations?.length,
      )
    )
      throw new Error(
        "a2ui-format: invalid first attempt painted before retry",
      );
  }
  const progressive = tagged.filter(
    (e) =>
      e.at < end.at &&
      e.at < finished.at &&
      Array.isArray(e.payload.content?.a2ui_operations),
  );
  // The SDK emits full current-state operation snapshots (commonly the
  // same create/components/data triplet), not an append-only operation log.
  // Compare structure, ignoring object key order, while keeping array order.
  const pair = progressive.some((first, i) =>
    progressive
      .slice(i + 1)
      .some(
        (second) =>
          first.payload.content.a2ui_operations.length > 0 &&
          second.payload.content.a2ui_operations.length > 0 &&
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
    const roots = Array.from(
      (globalThis as any).document.querySelectorAll("[data-surface-id]"),
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
        inferenceFormat: event.payload.content?.inferenceFormat,
        operations: event.payload.content?.a2ui_operations?.length,
      })),
      paints: evidence.paints.map((paint: A2uiEvidence["paints"][number]) => ({
        at: Math.round(paint.at),
        count: paint.count,
      })),
    }),
  );
  assertA2uiEvidence(evidence, format, mode);
}
