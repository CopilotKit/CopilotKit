import { describe, it, expect } from "vitest";
import { runBuildCheck } from "./verify-shell-docs.js";
import { checkInlineDemoRefs } from "./verify-shell-docs.js";
import { checkSnippetRegions } from "./verify-shell-docs.js";

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

describe("checkSnippetRegions", () => {
  it("fails when a referenced region is not in any demo's regions map", () => {
    const demoContent = {
      demos: {
        "langgraph-python::frontend-tools": {
          regions: {
            "frontend-tool-registration": {
              file: "src/page.tsx",
              startLine: 10,
              endLine: 20,
              code: "...",
              language: "tsx",
            },
          },
          files: [],
        },
      },
    };
    const pages = [
      {
        path: "frontend-tools.mdx",
        body: '<Snippet region="nope" />',
      },
    ];
    const result = checkSnippetRegions({ pages, demoContent });
    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain("nope");
  });

  it("passes when every region is present in at least one demo", () => {
    const demoContent = {
      demos: {
        "langgraph-python::frontend-tools": {
          regions: {
            "frontend-tool-registration": {
              file: "src/page.tsx",
              startLine: 10,
              endLine: 20,
              code: "...",
              language: "tsx",
            },
          },
          files: [],
        },
      },
    };
    const pages = [
      {
        path: "frontend-tools.mdx",
        body: '<Snippet region="frontend-tool-registration" />',
      },
    ];
    const result = checkSnippetRegions({ pages, demoContent });
    expect(result.status).toBe("pass");
  });
});
