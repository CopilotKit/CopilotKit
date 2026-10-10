import { describe, expect, it } from "vitest";
import type { TraceStep, TrajectoryDetail } from "../data/contract";
import { findStep, genUiOf, withGenUi } from "./derive";

const call = (over: Partial<TraceStep>): TraceStep => ({
  id: "s1",
  kind: "tool.call",
  status: "ok",
  at: 1_000,
  ...over,
});

describe("which generative UI a recorded call drew", () => {
  it("reads the close status card the in-app tool returned", () => {
    const props = { card: { id: "card_4417" }, exceptions: [] };
    expect(
      genUiOf(
        call({
          name: "showCloseStatus",
          result: { component: "CloseStatusCard", props },
        }),
        "in_app",
      ),
    ).toEqual({ component: "CloseStatusCard", props });
  });

  it("draws a report card in the app and the MCP app in ChatGPT", () => {
    const report = { id: "EXP-2295", lines: [{ amount: 1 }] };
    expect(
      genUiOf(call({ name: "getReport", result: report }), "in_app"),
    ).toEqual({ component: "ReportCard", props: { report } });
    expect(
      genUiOf(
        call({
          name: "getReport",
          result: { ...report, kind: "report-card", report },
        }),
        "chatgpt",
      )?.component,
    ).toBe("LedgerlineAppWidget");
  });

  it("draws nothing for a refused call or a one-row list", () => {
    expect(
      genUiOf(
        call({
          name: "showCloseStatus",
          status: "error",
          result: { error: "NOT_FOUND" },
        }),
        "in_app",
      ),
    ).toBeNull();
    expect(
      genUiOf(
        call({ name: "listReports", result: { reports: [{ id: "x" }] } }),
        "in_app",
      ),
    ).toBeNull();
  });

  it("shows ChatGPT's review card closed once the card's Confirm closed it", () => {
    const review = call({
      name: "reviewMatches",
      args: { sessionId: "rs_1" },
      result: { kind: "review-card", sessionId: "rs_1", pairs: [], note: "x" },
    });
    const confirm = call({
      id: "s2",
      at: 2_000,
      name: "confirmMatches",
      args: { sessionId: "rs_1" },
      result: { ok: true, closed: true, summary: "September closed." },
    });
    const ui = genUiOf(review, "chatgpt", [review, confirm]);
    const sc = ui?.props.structuredContent as Record<string, unknown>;
    expect(sc.outcome).toEqual({ ok: true, summary: "September closed." });
    expect(sc.note).toBeUndefined();
  });

  it("marks every step of a trajectory and finds one by thread and step", () => {
    const detail = {
      trajectory: {},
      events: [],
      missingContext: [],
      threads: [
        {
          threadId: "thr_a",
          surface: "in_app",
          linkStrength: "strong",
          outcome: "succeeded",
          messages: [],
          agentTrace: [
            call({
              name: "loadLearnedSkill",
              args: { name: "close-card-exceptions" },
              result:
                "LOADED learned skill close-card-exceptions (revision 1).",
            }),
          ],
        },
      ],
    } as unknown as TrajectoryDetail;
    const marked = withGenUi(detail);
    expect(marked.threads[0]!.agentTrace[0]!.ui?.component).toBe(
      "LearnedSkillCard",
    );
    expect(findStep(marked, "thr_a:s1")?.surface).toBe("in_app");
    expect(findStep(marked, "thr_b:s1")).toBeNull();
  });
});
