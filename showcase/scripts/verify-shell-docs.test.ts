import { describe, it, expect } from "vitest";
import { runBuildCheck } from "./verify-shell-docs.js";
import { checkInlineDemoRefs } from "./verify-shell-docs.js";

describe("runBuildCheck", () => {
  it("returns a result with name, status, and messages", () => {
    const result = runBuildCheck({ skipExecution: true });
    expect(result.name).toBe("nx-build-shell-docs");
    expect(["pass", "fail", "skipped"]).toContain(result.status);
    expect(Array.isArray(result.messages)).toBe(true);
  });
});

describe("checkInlineDemoRefs", () => {
  it("fails when a referenced demo id is not in registry", () => {
    const fakeRegistry = {
      integrations: [
        {
          slug: "langgraph-python",
          demos: [{ id: "agentic-chat" }],
        },
      ],
    };
    const pages = [
      {
        path: "frontend-tools.mdx",
        body: '<InlineDemo demo="not-a-real-demo" />',
      },
    ];
    const result = checkInlineDemoRefs({ pages, registry: fakeRegistry });
    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain("not-a-real-demo");
  });

  it("passes when every referenced demo id is in the registry", () => {
    const fakeRegistry = {
      integrations: [
        {
          slug: "langgraph-python",
          demos: [{ id: "agentic-chat" }, { id: "frontend-tools" }],
        },
      ],
    };
    const pages = [
      { path: "frontend-tools.mdx", body: '<InlineDemo demo="frontend-tools" />' },
    ];
    const result = checkInlineDemoRefs({ pages, registry: fakeRegistry });
    expect(result.status).toBe("pass");
  });
});
