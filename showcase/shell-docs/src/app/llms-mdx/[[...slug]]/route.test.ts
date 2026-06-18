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
}));

vi.mock("@/lib/frontend-page-content", () => ({
  FRONTEND_GUIDANCE_CONTENT_SLUG: "frontends/using-these-docs",
  getFrontendContentSlug: vi.fn((id: string) => `frontends/${id}`),
}));

vi.mock("@/lib/frontend-options", () => ({
  isFrontendId: vi.fn((value: string | undefined) =>
    ["react", "vue", "react-native", "slack", "teams"].includes(value ?? ""),
  ),
}));

vi.mock("@/lib/registry", () => ({
  getDocsFolder: vi.fn((slug: string) =>
    slug === "langgraph-python" ? "langgraph" : slug,
  ),
  getDocsMode: vi.fn(() => "generated"),
  getIntegrations: vi.fn(() => [{ slug: "langgraph-python" }]),
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
      slug === "langgraph-python" ? "langgraph" : slug,
    );
    getDocsModeMock.mockReturnValue("generated");
    getIntegrationsMock.mockReturnValue([
      { slug: "langgraph-python" } as never,
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

  it("serves frontend quickstart markdown from the frontend guide content", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "frontends/slack"
        ? {
            source: "",
            filePath: "frontends/slack.mdx",
            fm: {
              title: "Slack Quickstart",
              description: "Slack frontend docs.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute(["frontends", "slack"]);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("rendered markdown");
    expect(loadDocMock).toHaveBeenCalledWith("frontends/slack");
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "frontends/slack",
        filePath: "frontends/slack.mdx",
        loadSlug: "frontends/slack",
      }),
      { framework: undefined },
    );
  });

  it("serves frontend guidance markdown from the shared guidance page", async () => {
    loadDocMock.mockImplementation((slug: string) =>
      slug === "frontends/using-these-docs"
        ? {
            source: "",
            filePath: "frontends/using-these-docs.mdx",
            fm: {
              title: "Using these docs",
              description: "How to read frontend docs.",
            },
          }
        : null,
    );

    const response = await callLlmsMdxRoute([
      "frontends",
      "slack",
      "using-these-docs",
    ]);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("rendered markdown");
    expect(loadDocMock).toHaveBeenCalledWith("frontends/using-these-docs");
    expect(renderPageToLlmTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "frontends/slack/using-these-docs",
        filePath: "frontends/using-these-docs.mdx",
        loadSlug: "frontends/using-these-docs",
      }),
      { framework: undefined },
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
      "frontends",
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
        url: "frontends/slack/concepts/architecture",
        filePath: "concepts/architecture.mdx",
        loadSlug: "concepts/architecture",
      }),
      { framework: undefined },
    );
  });
});
