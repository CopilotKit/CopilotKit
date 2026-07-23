import { describe, it, expect } from "vitest";
import { runBuildCheck } from "./verify-shell-docs.js";
import { checkInlineDemoRefs } from "./verify-shell-docs.js";
import { checkSnippetRegions } from "./verify-shell-docs.js";
import { checkInternalLinks } from "./verify-shell-docs.js";
import { checkImportPaths } from "./verify-shell-docs.js";
import { checkComponentImports } from "./verify-shell-docs.js";
import { checkClaudeQuickstarts } from "./verify-shell-docs.js";
import { checkUnexpectedMultiFileRegionSources } from "./verify-shell-docs.js";

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
      {
        path: "frontend-tools.mdx",
        body: '<InlineDemo demo="frontend-tools" />',
      },
    ];
    const result = checkInlineDemoRefs({ pages, registry: fakeRegistry });
    expect(result.status).toBe("pass");
  });

  it("ignores InlineDemo refs inside fenced code blocks", () => {
    // A docs page that *shows* `<InlineDemo demo="some-example" />` in a
    // code sample (for users to copy) must not register that as a real
    // demo reference — otherwise the validator false-positives on every
    // tutorial that documents how to use InlineDemo.
    const fakeRegistry = {
      integrations: [
        { slug: "langgraph-python", demos: [{ id: "agentic-chat" }] },
      ],
    };
    const pages = [
      {
        path: "tutorial.mdx",
        body:
          "Here is how to embed a demo:\n\n```mdx\n" +
          '<InlineDemo demo="not-a-real-demo" />\n' +
          "```\n",
      },
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

describe("checkUnexpectedMultiFileRegionSources", () => {
  it("fails when a multi-file region is not explicitly allowlisted", () => {
    const result = checkUnexpectedMultiFileRegionSources({
      sources: [
        {
          demoKey: "claude-sdk-python::gen-ui-tool-based",
          regionName: "bar-chart-renderer",
          files: ["page.tsx", "bar-chart-renderer.snippet.tsx"],
        },
      ],
    });

    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain("bar-chart-renderer");
  });

  it("passes for the known intentional multi-file snippets", () => {
    const result = checkUnexpectedMultiFileRegionSources({
      sources: [
        {
          demoKey: "claude-sdk-python::open-gen-ui-advanced",
          regionName: "sandbox-function-registration",
          files: ["page.tsx", "sandbox-functions.ts"],
        },
      ],
    });

    expect(result.status).toBe("pass");
  });
});

describe("checkInternalLinks", () => {
  it("fails when an internal link does not resolve to a known page", () => {
    const pages = [{ path: "a.mdx", body: "[link](/does-not-exist)" }];
    const knownRoutes = new Set(["/a", "/b"]);
    const result = checkInternalLinks({ pages, knownRoutes });
    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain("/does-not-exist");
  });

  it("ignores external links", () => {
    const pages = [{ path: "a.mdx", body: "[link](https://example.com)" }];
    const knownRoutes = new Set<string>();
    const result = checkInternalLinks({ pages, knownRoutes });
    expect(result.status).toBe("pass");
  });

  it("strips fragments and queries before resolution", () => {
    const pages = [{ path: "a.mdx", body: "[link](/a#section?q=1)" }];
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
    expect(result.messages.join(" ")).toContain(
      "@/snippets/does-not-exist.mdx",
    );
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

describe("checkComponentImports", () => {
  it("fails when a snippet component is used with props but no import", () => {
    const pages = [
      {
        path: "agno/prebuilt-components.mdx",
        body: '<PrebuiltComponents components={props.components} framework="agno" />',
      },
    ];
    const result = checkComponentImports({ pages });
    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain("PrebuiltComponents");
  });

  it("passes when a snippet component has an explicit import", () => {
    const pages = [
      {
        path: "agno/prebuilt-components.mdx",
        body:
          'import PrebuiltComponents from "@/snippets/shared/basics/prebuilt-components.mdx";\n\n' +
          '<PrebuiltComponents components={props.components} framework="agno" />',
      },
    ];
    const result = checkComponentImports({ pages });
    expect(result.status).toBe("pass");
  });

  it("passes when a bare component is used without props or import", () => {
    const pages = [
      {
        path: "some-page.mdx",
        body: "<PrebuiltComponents />",
      },
    ];
    const result = checkComponentImports({ pages });
    expect(result.status).toBe("pass");
  });
});

describe("checkClaudeQuickstarts", () => {
  const validPythonQuickstart = `
<TailoredContent className="step" id="agent">
  <TailoredContentOption id="starter" title="Start from scratch" description="starter">
    npx copilotkit@latest init --framework claude-sdk-python
    - \`src/agent_server.py\` - backend
    - \`src/agents/claude_agent_sdk_adapter.py\` - adapter
    - \`src/app/api/copilotkit/route.ts\` - runtime
    ANTHROPIC_API_KEY=your_anthropic_api_key
    ANTHROPIC_MODEL=claude-sonnet-4-6
    AGENT_URL=http://localhost:8000
  </TailoredContentOption>
  <TailoredContentOption id="bring-your-own" title="Use an existing agent" description="byoa">
    \`\`\`bash
    uv add claude-agent-sdk ag-ui-claude-sdk ag-ui-protocol anthropic fastapi uvicorn python-dotenv
    \`\`\`

    \`\`\`python title="main.py"
    import os
    from ag_ui.core import EventType, RunAgentInput, RunErrorEvent
    from ag_ui.encoder import EventEncoder
    from ag_ui_claude_sdk import ClaudeAgentAdapter
    from fastapi import FastAPI, Request
    from fastapi.responses import StreamingResponse

    app = FastAPI()
    @app.get("/health")
    async def health():
        return {"status": "ok"}
    @app.post("/")
    async def run_agent(request: Request):
        input_data = RunAgentInput(**(await request.json()))
        adapter = ClaudeAgentAdapter(model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"))
        async def event_stream():
            try:
                async for event in adapter.run(input_data):
                    yield EventEncoder().encode(event)
            except Exception as exc:
                yield EventEncoder().encode(RunErrorEvent(type=EventType.RUN_ERROR, message=str(exc)))
        return StreamingResponse(event_stream(), media_type="text/event-stream")
    \`\`\`

    \`\`\`bash
    curl http://localhost:8000/health
    npm install @copilotkit/runtime @copilotkit/react-core @ag-ui/client
    \`\`\`

    \`\`\`ts title="app/api/copilotkit/route.ts"
    import { HttpAgent } from "@ag-ui/client";
    import { CopilotRuntime, ExperimentalEmptyAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
    const runtime = new CopilotRuntime({ agents: { claude_agent: new HttpAgent({ url: process.env.AGENT_URL ?? "http://localhost:8000" }) } });
    \`\`\`

    \`\`\`tsx title="app/layout.tsx"
    import { CopilotKit } from "@copilotkit/react-core/v2";
    <CopilotKit runtimeUrl="/api/copilotkit" agent="claude_agent" />
    \`\`\`

    \`\`\`tsx title="app/page.tsx"
    import { CopilotSidebar } from "@copilotkit/react-core/v2";
    \`\`\`
  </TailoredContentOption>
</TailoredContent>

## Backend tools and state

<FrameworkSetup concept="agent-setup" />
`;

  const validTypeScriptQuickstart = `
<TailoredContent className="step" id="agent">
  <TailoredContentOption id="starter" title="Start from scratch" description="starter">
    npx copilotkit@latest init --framework claude-sdk-typescript
    - \`src/agent_server.ts\` - backend
    - \`src/app/api/copilotkit/route.ts\` - runtime
    - \`src/app/page.tsx\` - frontend
    ANTHROPIC_API_KEY=your_anthropic_api_key
    CLAUDE_MODEL=claude-sonnet-4-6
    AGENT_URL=http://localhost:8000
  </TailoredContentOption>
  <TailoredContentOption id="bring-your-own" title="Use an existing agent" description="byoa">
    \`\`\`bash
    npm install @anthropic-ai/claude-agent-sdk@^0.2.58 @anthropic-ai/sdk @ag-ui/claude-agent-sdk @ag-ui/core @ag-ui/encoder express dotenv zod
    npm install -D typescript tsx @types/node @types/express
    \`\`\`

    \`\`\`ts title="src/agent-server.ts"
    import express from "express";
    import { EventType, type RunAgentInput } from "@ag-ui/core";
    import { EventEncoder } from "@ag-ui/encoder";
    import { ClaudeAgentAdapter } from "@ag-ui/claude-agent-sdk";
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    const agent = new ClaudeAgentAdapter({});
    app.post("/", (req, res) => {
      const encoder = new EventEncoder();
      res.setHeader("Content-Type", "text/event-stream");
      agent.run(req.body as RunAgentInput).subscribe({
        next: (event) => res.write(encoder.encodeSSE(event)),
        error: () => res.write(encoder.encodeSSE({ type: EventType.RUN_ERROR })),
      });
    });
    app.get("/health", (_req, res) => res.json({ status: "ok" }));
    app.listen(process.env.AGENT_PORT ?? 8000);
    \`\`\`

    \`\`\`bash
    curl http://localhost:8000/health
    npm install @copilotkit/runtime @copilotkit/react-core @ag-ui/client
    \`\`\`

    \`\`\`ts title="app/api/copilotkit/route.ts"
    import { HttpAgent } from "@ag-ui/client";
    import { CopilotRuntime, ExperimentalEmptyAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
    const runtime = new CopilotRuntime({ agents: { claude_agent: new HttpAgent({ url: process.env.AGENT_URL ?? "http://localhost:8000" }) } });
    \`\`\`

    \`\`\`tsx title="app/layout.tsx"
    import { CopilotKit } from "@copilotkit/react-core/v2";
    <CopilotKit runtimeUrl="/api/copilotkit" agent="claude_agent" />
    \`\`\`

    \`\`\`tsx title="app/page.tsx"
    import { CopilotSidebar } from "@copilotkit/react-core/v2";
    \`\`\`
  </TailoredContentOption>
</TailoredContent>

## Backend tools and state

<FrameworkSetup concept="agent-setup" />
`;

  function runWith(overrides: Partial<Record<string, string>> = {}) {
    return checkClaudeQuickstarts({
      pages: [
        {
          path: "integrations/claude-sdk-python/quickstart.mdx",
          body: overrides.python ?? validPythonQuickstart,
        },
        {
          path: "integrations/claude-sdk-typescript/quickstart.mdx",
          body: overrides.typescript ?? validTypeScriptQuickstart,
        },
      ],
      setupSource: () =>
        "### Bridge Claude Agent SDK to AG-UI\n```ts\nClaudeAgentAdapter\n```",
      starterFileExists: () => true,
    });
  }

  it("passes when both Claude quickstarts expose starter, BYOA, setup, and runnable snippet contracts", () => {
    const result = runWith();
    expect(result.messages).toEqual([]);
    expect(result.status).toBe("pass");
  });

  it("fails when a documented starter file is not present in the extracted starter", () => {
    const result = checkClaudeQuickstarts({
      pages: [
        {
          path: "integrations/claude-sdk-python/quickstart.mdx",
          body: validPythonQuickstart,
        },
        {
          path: "integrations/claude-sdk-typescript/quickstart.mdx",
          body: validTypeScriptQuickstart,
        },
      ],
      setupSource: () =>
        "### Bridge Claude Agent SDK to AG-UI\n```ts\nClaudeAgentAdapter\n```",
      starterFileExists: (_slug, filePath) =>
        filePath !== "src/agent_server.py",
    });

    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain("src/agent_server.py");
  });

  it("fails when the TypeScript BYOA server negotiates protobuf but writes SSE bytes", () => {
    const result = runWith({
      typescript: validTypeScriptQuickstart.replace(
        'const encoder = new EventEncoder();\n      res.setHeader("Content-Type", "text/event-stream");',
        'const encoder = new EventEncoder({ accept: req.headers.accept });\n      res.setHeader("Content-Type", encoder.getContentType());',
      ),
    });

    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain(
      "writes SSE frames but negotiates a non-SSE content type",
    );
  });

  it("fails when the frontend install command omits the AG-UI client package", () => {
    const result = runWith({
      typescript: validTypeScriptQuickstart.replace(
        "npm install @copilotkit/runtime @copilotkit/react-core @ag-ui/client",
        "npm install @copilotkit/runtime @copilotkit/react-core",
      ),
    });

    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain(
      "frontend install command missing package @ag-ui/client",
    );
  });

  it("fails when the Python BYOA snippet does not stream adapter output", () => {
    const result = runWith({
      python: validPythonQuickstart.replace(
        "adapter.run(input_data)",
        "adapter.run()",
      ),
    });

    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain("main.py missing adapter run");
  });

  it("fails when the TypeScript BYOA server omits JSON body parsing", () => {
    const result = runWith({
      typescript: validTypeScriptQuickstart.replace(
        '    app.use(express.json({ limit: "10mb" }));\n',
        "",
      ),
    });

    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain(
      "src/agent-server.ts missing JSON body parser",
    );
  });

  it("fails when the quickstart does not render the setup guide", () => {
    const result = runWith({
      python: validPythonQuickstart.replace(
        '<FrameworkSetup concept="agent-setup" />',
        "",
      ),
    });

    expect(result.status).toBe("fail");
    expect(result.messages.join(" ")).toContain(
      'FrameworkSetup concept="agent-setup"',
    );
  });
});
