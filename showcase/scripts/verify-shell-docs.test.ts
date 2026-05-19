import { describe, it, expect } from "vitest";
import { runBuildCheck } from "./verify-shell-docs.js";
import { checkInlineDemoRefs } from "./verify-shell-docs.js";
import { checkSnippetRegions } from "./verify-shell-docs.js";
import { checkInternalLinks } from "./verify-shell-docs.js";
import { checkImportPaths } from "./verify-shell-docs.js";

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

describe("checkInternalLinks", () => {
  it("fails when an internal link does not resolve to a known page", () => {
    const pages = [
      { path: "a.mdx", body: "[link](/does-not-exist)" },
    ];
    const knownRoutes = new Set(["/a", "/b"]);
    const result = checkInternalLinks({ pages, knownRoutes });
    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain("/does-not-exist");
  });

  it("ignores external links", () => {
    const pages = [
      { path: "a.mdx", body: "[link](https://example.com)" },
    ];
    const knownRoutes = new Set<string>();
    const result = checkInternalLinks({ pages, knownRoutes });
    expect(result.status).toBe("pass");
  });

  it("strips fragments and queries before resolution", () => {
    const pages = [
      { path: "a.mdx", body: "[link](/a#section?q=1)" },
    ];
    const knownRoutes = new Set(["/a"]);
    const result = checkInternalLinks({ pages, knownRoutes });
    expect(result.status).toBe("pass");
  });
});

describe("checkImportPaths", () => {
  it("fails when an @/snippets/... path does not exist", () => {
    const pages = [
      {
        path: "a.mdx",
        body: 'import X from "@/snippets/does-not-exist.mdx";',
      },
    ];
    const existsOnDisk = (_p: string) => false;
    const result = checkImportPaths({ pages, existsOnDisk });
    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain("@/snippets/does-not-exist.mdx");
  });

  it("passes when all paths resolve", () => {
    const pages = [
      {
        path: "a.mdx",
        body: 'import X from "@/snippets/exists.mdx";',
      },
    ];
    const existsOnDisk = (_p: string) => true;
    const result = checkImportPaths({ pages, existsOnDisk });
    expect(result.status).toBe("pass");
  });
});
