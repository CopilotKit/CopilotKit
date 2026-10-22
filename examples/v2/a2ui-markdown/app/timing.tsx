"use client";

import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

type ServerTiming = {
  run_id: string;
  phase: string;
  model_calls: Array<{
    request_ms: number;
    first_text_ms?: number;
    first_response_ms?: number;
    first_tool_call_ms?: number;
    end_ms?: number;
  }>;
  ag_ui_first_text_ms?: number;
  ag_ui_last_text_ms?: number;
  ag_ui_text_chunks: number;
};

type TimingReport = {
  runId: string;
  agentId: string;
  browser: Record<string, number>;
  server?: ServerTiming;
};

declare global {
  interface Window {
    /** Last 20 runs, metadata only. Copy as JSON from the browser console. */
    adkDemoTimings?: TimingReport[];
  }
}

const roots = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>("[data-generative-ui-root]"),
  );

/** A visible leaf or control, excluding empty layouts, styles and error panels. */
function hasVisibleContent(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).some((element) => {
    if (element.closest("style, script, [data-generative-ui-error]"))
      return false;
    const content =
      element.matches("svg, canvas, img, input, select, textarea, button") ||
      (element.childElementCount === 0 && !!element.textContent?.trim());
    if (
      !content ||
      !element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
    )
      return false;
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  });
}

/** Demo-only observations; no renderer or Inspector behavior is changed. */
export function DemoTiming({ agentId }: { agentId: string }) {
  const { agent } = useAgent({ agentId });

  useEffect(() => {
    let cleanupRun = () => {};
    const runs = new Map<
      string,
      {
        report: TimingReport;
        start: number;
        finish: () => void;
      }
    >();

    const subscription = agent.subscribe({
      onRunInitialized({ input }) {
        cleanupRun();
        const report: TimingReport = {
          runId: input.runId,
          agentId,
          browser: {},
        };
        window.adkDemoTimings = [
          ...(window.adkDemoTimings ?? []).slice(-19),
          report,
        ];
        const start = performance.now();
        const baseline = new Map(roots().map((root) => [root, root.innerHTML]));
        let frame = 0;
        let stopped = false;
        const elapsed = () =>
          Math.round((performance.now() - start) * 1000) / 1000;
        const inspect = () => {
          if (stopped || report.browser.first_surface_paint_ms !== undefined)
            return;
          const visible = roots().some(
            (root) =>
              baseline.get(root) !== root.innerHTML && hasVisibleContent(root),
          );
          if (visible) {
            report.browser.first_surface_paint_ms = elapsed();
            console.info(
              "[adk-demo timing] first visible surface",
              report.runId,
              report.browser,
            );
          }
        };
        const schedule = () => {
          if (frame || stopped) return;
          // Two animation frames allow a paint opportunity after React commits.
          // This is a visibility/paint proxy, not a GPU presentation timestamp.
          frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
              frame = 0;
              inspect();
            });
          });
        };
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        window.addEventListener("scroll", schedule, true);
        window.addEventListener("resize", schedule);
        const cleanup = () => {
          stopped = true;
          observer.disconnect();
          cancelAnimationFrame(frame);
          window.removeEventListener("scroll", schedule, true);
          window.removeEventListener("resize", schedule);
          runs.delete(input.runId);
        };
        const finish = () => {
          // Let React commit the last event before ending the observation.
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
              inspect();
              console.info(
                "[adk-demo timing] completed",
                JSON.stringify(report),
              );
              cleanup();
            });
          });
        };
        cleanupRun = cleanup;
        runs.set(input.runId, { report, start, finish });
      },
      onRunStartedEvent({ input }) {
        const run = runs.get(input.runId);
        if (run)
          run.report.browser.run_started_ms = performance.now() - run.start;
      },
      onTextMessageContentEvent({ input }) {
        const run = runs.get(input.runId);
        if (!run) return;
        const elapsed = performance.now() - run.start;
        run.report.browser.first_text_ms ??= elapsed;
        run.report.browser.last_text_ms = elapsed;
      },
      onCustomEvent({ event, input }) {
        const run = runs.get(input.runId);
        if (
          run &&
          event.name === "adk_demo_timing" &&
          event.value?.run_id === input.runId
        ) {
          run.report.server = event.value as ServerTiming;
        }
      },
      onRunFinalized({ input }) {
        const run = runs.get(input.runId);
        if (run) {
          run.report.browser.finished_ms = performance.now() - run.start;
          run.finish();
        }
      },
    });
    return () => {
      subscription.unsubscribe();
      cleanupRun();
    };
  }, [agent, agentId]);
  return null;
}
