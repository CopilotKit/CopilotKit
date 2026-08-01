import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDoc } from "@/lib/docs-render";
import { resolveFrontendDocPage } from "@/lib/frontend-doc-policy";
import { getFrontendContentSlug } from "@/lib/frontend-page-content";
import { getDocsFolder, getDocsMode, getIntegrations } from "@/lib/registry";
import { renderPageToLlmText } from "@/lib/llm-text";
import { GET } from "./route";

vi.mock("@/lib/docs-render", () => ({
  loadDoc: vi.fn(),
}));

vi.mock("@/lib/frontend-doc-policy", () => ({
  resolveFrontendDocPage: vi.fn(),
  isFrontendFirstClassDoc: vi.fn(() => true),
}));

vi.mock("@/lib/frontend-page-content", () => ({
  getFrontendContentSlug: vi.fn((id: string) => `frontends/${id}`),
  getFrontendGuidanceContentSlug: vi.fn(() => "frontends/docs-status"),
}));

vi.mock("@/lib/frontend-options", () => ({
  isChannelFrontend: vi.fn(
    (value: string) => value === "slack" || value === "teams",
  ),
  isFrontendId: vi.fn((value: string | undefined) =>
    ["react", "vue", "react-native", "angular", "slack", "teams"].includes(
      value ?? "",
    ),
  ),
  parseFrontendRoutePath: vi.fn(
    (pathname: string, backendFrameworkSlugs: readonly string[] = []) => {
      const [first, ...rest] = pathname.split("/").filter(Boolean);
      if (
        !["vue", "react-native", "angular", "slack", "teams"].includes(
          first ?? "",
        )
      ) {
        return null;
      }
      const [maybeBackend, ...tail] = rest;
      const backend =
        maybeBackend && backendFrameworkSlugs.includes(maybeBackend)
          ? maybeBackend
          : null;
      return {
        frontend: first,
        backend,
        slugPath: backend ? tail.join("/") : rest.join("/"),
      };
    },
  ),
}));

vi.mock("@/lib/registry", () => ({
  getDocsFolder: vi.fn((slug: string) =>
    slug === "langgraph-python" || slug === "langgraph-typescript"
      ? "langgraph"
      : slug === "google-adk"
        ? "adk"
        : slug,
  ),
  getDocsMode: vi.fn(() => "generated"),
  getIntegrations: vi.fn(() => [
    { slug: "langgraph-python" },
    { slug: "langgraph-typescript" },
  ]),
  ROOT_FRAMEWORK: "built-in-agent",
}));

vi.mock("@/lib/llm-text", () => ({
  renderPageToLlmText: vi.fn(() => "rendered markdown"),
}));

vi.mock("@/lib/reference-items", () => ({
  resolveReferencePage: vi.fn(),
}));

vi.mock("@/lib/sitemap-helpers", () => ({
  AG_UI_CONTENT_DIR: "/tmp/ag-ui",
}));

const loadDocMock = vi.mocked(loadDoc);
const resolveFrontendDocPageMock = vi.mocked(resolveFrontendDocPage);
const getFrontendContentSlugMock = vi.mocked(getFrontendContentSlug);
const getDocsFolderMock = vi.mocked(getDocsFolder);
const getDocsModeMock = vi.mocked(getDocsMode);
const getIntegrationsMock = vi.mocked(getIntegrations);
const renderPageToLlmTextMock = vi.mocked(renderPageToLlmText);

function callLlmsMdxRoute(slug: string[]) {
  return GET(new Request("http://localhost:3003/test.mdx"), {
    params: Promise.resolve({ slug }),
  });
}

describe("llms-mdx route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFrontendContentSlugMock.mockImplementation(
      (id: string) => `frontends/${id}`,
    );
    getDocsFolderMock.mockImplementation((slug: string) =>
      slug === "langgraph-python" || slug === "langgraph-typescript"
        ? "langgraph"
        : slug === "google-adk"
          ? "adk"
          : slug,
    );
    getDocsModeMock.mockReturnValue("generated");
    getIntegrationsMock.mockReturnValue([
      { slug: "langgraph-python" } as never,
      { slug: "langgraph-typescript" } as never,
    ]);
    renderPageToLlmTextMock.mockReturnValue("rendered markdown");
  });

  it("prefers framework quickstart overrides for generated docs", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "integrations/langgraph/quickstart"
        ? {
            source: "",
            filePath: "integrations/langgraph/quickstart.mdx",
            fm: {
              title: "LangGraph Quickstart",
              description: "Framework-specific quickstart.",
            },
          }
        : slug === "quickstart"
          ? {
              source: "",
              filePath: "quickstart.mdx",
              fm: {
                title: "Root Quickstart",
                description: "Routing shim.",
              },
            }
          : null,
    );

    const response = await callLlmsMdxRoute(["langgraph-python", "quickstart"]);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("rendered markdown");
    expect(loadDocMock).toHaveBeenNthCalledWith(
      1,
      "integrations/langgraph/quickstart",
    );
    expect(loadDocMock).not.toHaveBeenCalledWith("quickstart");
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "integrations/langgraph/quickstart.mdx",
        framework: "langgraph-python",
        loadSlug: "integrations/langgraph/quickstart",
      }),
      { framework: "langgraph-python" },
    );
  });

  it("uses an authored quickstart as Markdown for a framework root without an index", async () => {
    getIntegrationsMock.mockReturnValue([
      { slug: "langgraph-python" } as never,
      { slug: "google-adk" } as never,
    ]);
    loadDocMock.mockImplementation((slug: string) =>
      slug === "integrations/adk/quickstart"
        ? {
            source: "",
            filePath: "integrations/adk/quickstart.mdx",
            fm: {
              title: "Google ADK Quickstart",
              description: "Connect a Google ADK agent.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute(["google-adk"]);

    expect(response.status).toBe(200);
    expect(loadDocMock).toHaveBeenCalledWith("integrations/adk/quickstart");
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "google-adk",
        filePath: "integrations/adk/quickstart.mdx",
        loadSlug: "integrations/adk/quickstart",
        framework: "google-adk",
      }),
      { framework: "google-adk" },
    );
  });

  it("keeps an authored framework index ahead of the root quickstart fallback", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "integrations/langgraph/index"
        ? {
            source: "",
            filePath: "integrations/langgraph/index.mdx",
            fm: {
              title: "LangGraph",
              description: "LangGraph overview.",
            },
          }
        : slug === "integrations/langgraph/quickstart"
          ? {
              source: "",
              filePath: "integrations/langgraph/quickstart.mdx",
              fm: {
                title: "LangGraph Quickstart",
                description: "LangGraph setup.",
              },
            }
          : null,
    );

    const response = await callLlmsMdxRoute(["langgraph-python"]);

    expect(response.status).toBe(200);
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "langgraph-python",
        loadSlug: "integrations/langgraph/index",
      }),
      { framework: "langgraph-python" },
    );
    expect(loadDocMock).not.toHaveBeenCalledWith(
      "integrations/langgraph/quickstart",
    );
  });

  it("does not expose a hidden framework root through Markdown fallback", async () => {
    getIntegrationsMock.mockReturnValue([
      { slug: "hidden-framework" } as never,
    ]);
    getDocsModeMock.mockReturnValue("hidden");

    const response = await callLlmsMdxRoute(["hidden-framework"]);

    expect(response.status).toBe(404);
    expect(loadDocMock).not.toHaveBeenCalled();
    expect(renderPageToLlmTextMock).not.toHaveBeenCalled();
  });

  it("serves channel connection markdown from the frontend guide content", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "frontends/slack"
        ? {
            source: "",
            filePath: "frontends/slack.mdx",
            fm: {
              title: "Connect and run your agent in Slack",
              description: "Slack frontend docs.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute(["slack", "connect"]);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("rendered markdown");
    expect(loadDocMock).toHaveBeenCalledWith("frontends/slack");
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "slack/connect",
        filePath: "frontends/slack.mdx",
        loadSlug: "frontends/slack",
        framework: "built-in-agent",
      }),
      { framework: "built-in-agent", frontend: "slack" },
    );
  });

  it("serves a default Slack guide from the shared Channels source", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "channels/tools"
        ? {
            source: "",
            filePath: "channels/tools.mdx",
            fm: {
              title: "Tools and context",
              description: "Channel tools.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute(["slack", "tools"]);

    expect(response.status).toBe(200);
    expect(loadDocMock).toHaveBeenCalledWith("channels/tools");
    expect(resolveFrontendDocPageMock).not.toHaveBeenCalled();
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "slack/tools",
        filePath: "channels/tools.mdx",
        loadSlug: "channels/tools",
        framework: "built-in-agent",
        frontend: "slack",
      }),
      { framework: "built-in-agent", frontend: "slack" },
    );
  });

  it("serves a framework-scoped Teams guide from the shared Channels source", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "channels/threads-and-state"
        ? {
            source: "",
            filePath: "channels/threads-and-state.mdx",
            fm: {
              title: "Threads and state",
              description: "Conversation state.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute([
      "teams",
      "langgraph-python",
      "threads-and-state",
    ]);

    expect(response.status).toBe(200);
    expect(loadDocMock).toHaveBeenCalledWith("channels/threads-and-state");
    expect(resolveFrontendDocPageMock).not.toHaveBeenCalled();
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "teams/langgraph-python/threads-and-state",
        filePath: "channels/threads-and-state.mdx",
        loadSlug: "channels/threads-and-state",
        framework: "langgraph-python",
        frontend: "teams",
      }),
      { framework: "langgraph-python", frontend: "teams" },
    );
  });

  it("keeps the selected framework while expanding a Slack connection guide", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "frontends/slack"
        ? {
            source: "",
            filePath: "frontends/slack.mdx",
            fm: {
              title: "Connect and run your agent in Slack",
              description: "Slack frontend docs.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute([
      "slack",
      "langgraph-python",
      "connect",
    ]);

    expect(response.status).toBe(200);
    expect(loadDocMock).toHaveBeenCalledWith("frontends/slack");
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "slack/langgraph-python/connect",
        loadSlug: "frontends/slack",
        framework: "langgraph-python",
        frontend: "slack",
      }),
      { framework: "langgraph-python", frontend: "slack" },
    );
  });

  it("fails closed for channel guides under a hidden framework", async () => {
    getIntegrationsMock.mockReturnValue([
      { slug: "langgraph-python" } as never,
      { slug: "hidden-framework" } as never,
    ]);
    getDocsModeMock.mockImplementation((slug: string) =>
      slug === "hidden-framework" ? "hidden" : "generated",
    );

    const response = await callLlmsMdxRoute([
      "slack",
      "hidden-framework",
      "tools",
    ]);

    expect(response.status).toBe(404);
    expect(loadDocMock).not.toHaveBeenCalled();
    expect(resolveFrontendDocPageMock).not.toHaveBeenCalled();
    expect(renderPageToLlmTextMock).not.toHaveBeenCalled();
  });

  it("serves frontend quickstart markdown under two-axis frontend/backend root URLs", async () => {
    resolveFrontendDocPageMock.mockReturnValue({ status: "not-found" });
    loadDocMock.mockImplementation((slug: string) =>
      slug === "frontends/vue"
        ? {
            source: "",
            filePath: "frontends/vue.mdx",
            fm: {
              title: "Vue Quickstart",
              description: "Vue frontend docs.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute(["vue", "langgraph-python"]);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("rendered markdown");
    expect(loadDocMock).toHaveBeenCalledWith("frontends/vue");
    expect(loadDocMock).not.toHaveBeenCalledWith("index");
    expect(loadDocMock).not.toHaveBeenCalledWith(
      "integrations/langgraph/index",
    );
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "vue/langgraph-python",
        filePath: "frontends/vue.mdx",
        loadSlug: "frontends/vue",
        framework: "langgraph-python",
      }),
      { framework: "langgraph-python", frontend: "vue" },
    );
  });

  it("serves legacy frontend guidance URLs from the shared docs-status page", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "frontends/docs-status"
        ? {
            source: "",
            filePath: "frontends/docs-status.mdx",
            fm: {
              title: "Docs status",
              description: "How to read frontend docs.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute(["slack", "using-these-docs"]);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("rendered markdown");
    expect(loadDocMock).toHaveBeenCalledWith("frontends/docs-status");
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "slack/using-these-docs",
        filePath: "frontends/docs-status.mdx",
        loadSlug: "frontends/docs-status",
        framework: "built-in-agent",
      }),
      { framework: "built-in-agent", frontend: "slack" },
    );
  });

  it("serves frontend guidance markdown under two-axis frontend/backend URLs", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "frontends/docs-status"
        ? {
            source: "",
            filePath: "frontends/docs-status.mdx",
            fm: {
              title: "Docs status",
              description: "What to expect while frontend docs catch up.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute([
      "react-native",
      "langgraph-typescript",
      "using-these-docs",
    ]);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("rendered markdown");
    expect(loadDocMock).toHaveBeenCalledWith("frontends/docs-status");
    expect(loadDocMock).not.toHaveBeenCalledWith("using-these-docs");
    expect(loadDocMock).not.toHaveBeenCalledWith(
      "integrations/langgraph/using-these-docs",
    );
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "react-native/langgraph-typescript/using-these-docs",
        filePath: "frontends/docs-status.mdx",
        loadSlug: "frontends/docs-status",
        framework: "langgraph-typescript",
      }),
      { framework: "langgraph-typescript", frontend: "react-native" },
    );
  });

  it("serves frontend nested markdown through the frontend doc policy", async () => {
    resolveFrontendDocPageMock.mockReturnValue({
      status: "found",
      slugPath: "concepts/architecture",
      contentSlugPath: "concepts/architecture",
      canonicalPath: "/concepts/architecture",
      policy: { kind: "universal" },
    });
    loadDocMock.mockImplementation((slug: string) =>
      slug === "concepts/architecture"
        ? {
            source: "",
            filePath: "concepts/architecture.mdx",
            fm: {
              title: "Architecture",
              description: "Shared architecture docs.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute([
      "slack",
      "concepts",
      "architecture",
    ]);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("rendered markdown");
    expect(resolveFrontendDocPageMock).toHaveBeenCalledWith(
      "slack",
      "concepts/architecture",
    );
    expect(loadDocMock).toHaveBeenCalledWith("concepts/architecture");
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "slack/concepts/architecture",
        filePath: "concepts/architecture.mdx",
        loadSlug: "concepts/architecture",
        framework: "built-in-agent",
      }),
      { framework: "built-in-agent", frontend: "slack" },
    );
  });

  it("serves shared Runtime markdown with Angular frontend substitutions", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "backend/copilot-runtime"
        ? {
            source: "",
            filePath: "backend/copilot-runtime.mdx",
            fm: {
              title: "Copilot Runtime",
              description: "Shared runtime docs.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute([
      "angular",
      "backend",
      "copilot-runtime",
    ]);

    expect(response.status).toBe(200);
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "angular/backend/copilot-runtime",
        loadSlug: "backend/copilot-runtime",
        framework: "built-in-agent",
      }),
      { framework: "built-in-agent", frontend: "angular" },
    );
  });

  it("serves Angular-native variants inside a selected backend route", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "frontends/angular/auth"
        ? {
            source: "",
            filePath: "frontends/angular/auth.mdx",
            fm: {
              title: "Authentication",
              description: "Angular authentication.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute([
      "angular",
      "langgraph-python",
      "auth",
    ]);

    expect(response.status).toBe(200);
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "angular/langgraph-python/auth",
        loadSlug: "frontends/angular/auth",
        framework: "langgraph-python",
      }),
      { framework: "langgraph-python", frontend: "angular" },
    );
  });
});
