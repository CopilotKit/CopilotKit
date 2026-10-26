/**
 * Validation of, and operator warnings about, the `threads` option (T8).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { ɵresetThreadAccessWarnings } from "../handlers/shared/thread-access";
import {
  identifyFromHeader,
  testAgents,
} from "./helpers/thread-access-harness";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ɵresetThreadAccessWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

function warnings(): string[] {
  return warn.mock.calls.map((call: unknown[]) => call.map(String).join(" "));
}

describe("threads.access validation", () => {
  it.each(["Open", "public", "", true])(
    "throws at construction on access %j",
    (access) => {
      // A JS caller, or JSON config, can pass any value.
      const threads = JSON.parse(JSON.stringify({ access }));
      expect(
        () => new CopilotRuntime({ agents: testAgents(), threads }),
      ).toThrow(/threads\.access must be "owner" or "open"/);
    },
  );

  it("throws at construction when threads is not an object", () => {
    const threads = JSON.parse('"open"');
    expect(() => new CopilotRuntime({ agents: testAgents(), threads })).toThrow(
      /`threads` must be an object/,
    );
  });

  it("accepts the two modes", () => {
    for (const access of ["owner", "open"] as const) {
      expect(
        new CopilotRuntime({ agents: testAgents(), threads: { access } })
          .threadAccess,
      ).toBe(access);
    }
  });
});

describe("startup warnings", () => {
  it("warns once that list and clear are refused in the default configuration", () => {
    new CopilotRuntime({ agents: testAgents() });
    new CopilotRuntime({ agents: testAgents() });
    const refused = warnings().filter((w) =>
      w.includes("Listing and clearing threads"),
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain("identifyUser");
    expect(refused[0]).toContain('threads: { access: "open" }');
  });

  it("does not warn when identity or open access is configured", () => {
    new CopilotRuntime({
      agents: testAgents(),
      identifyUser: identifyFromHeader,
    });
    new CopilotRuntime({ agents: testAgents(), threads: { access: "open" } });
    expect(
      warnings().filter((w) => w.includes("Listing and clearing threads")),
    ).toEqual([]);
  });

  it("warns that threads has no effect on an Intelligence runtime", () => {
    new CopilotRuntime({
      agents: {},
      intelligence: new CopilotKitIntelligence({
        apiUrl: "https://platform.test",
        wsUrl: "wss://platform.test",
        apiKey: "project-key",
      }),
      identifyUser: identifyFromHeader,
      threads: { access: "open" },
    });
    expect(
      warnings().filter((w) =>
        w.includes("`threads` has no effect on an Intelligence runtime"),
      ),
    ).toHaveLength(1);
  });
});
