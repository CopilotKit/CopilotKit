// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TrajectorySummary } from "../data/contract";
import { matches, parseSlice, queryText, sliceParams } from "./model";
import type { ExportFilter, ExportScope } from "./model";

const t = (over: Partial<TrajectorySummary>): TrajectorySummary => ({
  trajectoryId: "trj_1",
  projectId: "ledgerline-demo",
  title: "Close out Priya Raman's September card",
  user: { id: "u_maya", name: "Maya Chen" },
  createdAt: 0,
  firstEventAt: 0,
  lastEventAt: new Date("2026-10-04T12:00:00").getTime(),
  outcome: "agent_failed_user_completed",
  surfaces: ["in_app", "chatgpt", "manual"],
  threadIds: ["a", "b"],
  eventCount: 40,
  ...over,
});
const space: ExportScope = { space: "ledgerline-expenses", kind: "space" };

describe("trajectory export slices", () => {
  it("narrows a space to one user or a group", () => {
    const jordan = t({ user: { id: "u_jordan", name: "Jordan Patel" } });
    expect(matches(jordan, space, [])).toBe(true);
    expect(
      matches(jordan, { ...space, kind: "user", userId: "u_maya" }, []),
    ).toBe(false);
    expect(
      matches(
        jordan,
        { ...space, kind: "group", groupId: "grp_controllers" },
        [],
      ),
    ).toBe(true);
    expect(
      matches(
        t({}),
        { ...space, kind: "group", groupId: "grp_controllers" },
        [],
      ),
    ).toBe(false);
  });

  it("applies every filter row", () => {
    const f = (
      field: ExportFilter["field"],
      op: ExportFilter["op"],
      value: string,
    ) => [{ field, op, value }];
    expect(matches(t({}), space, f("surface", "=", "chatgpt"))).toBe(true);
    expect(
      matches(t({ surfaces: ["in_app"] }), space, f("surface", "=", "chatgpt")),
    ).toBe(false);
    expect(matches(t({}), space, f("outcome", "!=", "agent_succeeded"))).toBe(
      true,
    );
    expect(matches(t({}), space, f("title", "contains", "SEPTEMBER"))).toBe(
      true,
    );
    expect(matches(t({}), space, f("lastEventAt", ">=", "2026-10-05"))).toBe(
      false,
    );
    expect(matches(t({}), space, f("lastEventAt", "<=", "2026-10-04"))).toBe(
      true,
    );
    expect(matches(t({}), space, f("eventCount", ">=", "41"))).toBe(false);
  });

  it("round-trips through query params and reads as a query", () => {
    const scope: ExportScope = { ...space, kind: "user", userId: "u_maya" };
    const filters: ExportFilter[] = [
      { field: "surface", op: "=", value: "chatgpt" },
    ];
    const back = parseSlice(sliceParams(scope, filters, "parquet"));
    expect(back.scope.kind).toBe("user");
    expect(back.scope.userId).toBe("u_maya");
    expect(back.filters).toEqual(filters);
    expect(back.format).toBe("parquet");
    expect(queryText(scope, filters)).toBe(
      "SELECT * FROM trajectories\nWHERE space = 'ledgerline-expenses'\n  AND user.id = 'u_maya'\n  AND surface = 'chatgpt'",
    );
  });
});
