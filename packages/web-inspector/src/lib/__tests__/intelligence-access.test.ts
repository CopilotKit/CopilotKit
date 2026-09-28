import { expect, test, vi } from "vitest";
import { CopilotKitCore } from "@copilotkit/core";
import {
  observeIntelligenceAccess,
  intelligenceSections,
  parseIntelligenceAccess,
} from "../intelligence-access.js";

test("production scope exposes only granted sections and listed agents", () => {
  const access = parseIntelligenceAccess({
    version: 1,
    agents: ["support", "billing"],
    grant: {
      permissions: {
        "analytics.numbers": { agents: ["support"] },
        "governance.record": { agents: ["billing"] },
      },
    },
  });

  expect(access?.agents).toEqual(["support", "billing"]);
  expect(intelligenceSections(access)).toEqual([]);
  expect(intelligenceSections(access, "support")).toEqual(["analytics"]);
  expect(intelligenceSections(access, "billing")).toEqual(["governance"]);
  expect(intelligenceSections(access, "outside")).toEqual([]);
});

test("production scope rejects missing, empty and malformed grants", () => {
  const values = [
    null,
    {},
    { version: 1, agents: [], grant: { permissions: {} } },
    {
      version: 1,
      agents: [],
      grant: { permissions: { "governance.record": { agents: [] } } },
    },
    {
      version: 1,
      agents: [],
      grant: { permissions: { "governance.record": { agents: "all" } } },
    },
    {
      version: 1,
      agents: [],
      grant: { permissions: { "analytics.numbers": { agents: [""] } } },
    },
  ];

  for (const value of values) expect(parseIntelligenceAccess(value)).toBeNull();
  expect(intelligenceSections(null)).toEqual([]);
});

test("project-wide permissions expose product sections without development routes", () => {
  const access = parseIntelligenceAccess({
    version: 1,
    agents: ["support"],
    grant: {
      permissions: {
        "analytics.topics": { agents: "*" },
        "learning.insights_skills": { agents: "*" },
        "governance.record": { agents: "*" },
      },
    },
  });

  expect(intelligenceSections(access)).toEqual([
    "analytics",
    "governance",
    "memories",
  ]);
});

test("identity changes cancel stale grants and teardown stops subsequent reads", async () => {
  const core = new CopilotKitCore({
    runtimeUrl: "https://customer.example/runtime",
    deferInitialConnection: true,
  });
  let resolveFirst: (value: Response) => void = () => {
    throw new Error("Missing first request");
  };
  const first = new Promise<Response>((resolve) => {
    resolveFirst = resolve;
  });
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockReturnValueOnce(first)
    .mockResolvedValue(new Response(null, { status: 403 }));
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
  const changed = vi.fn();
  const stop = observeIntelligenceAccess(core, changed);
  try {
    core.setHeaders({ "X-Viewer": "second" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    resolveFirst(
      Response.json({
        version: 1,
        agents: ["support"],
        grant: { permissions: { "analytics.numbers": { agents: "*" } } },
      }),
    );
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changed.mock.calls.every(([access]) => access === null)).toBe(true);
    stop();
    core.setHeaders({ "X-Viewer": "third" });
    window.dispatchEvent(new Event("focus"));
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    stop();
    transport.mockRestore();
  }
});
