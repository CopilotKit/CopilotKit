import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDoc } from "@/lib/docs-render";
import { resolveFrontendDocPage } from "@/lib/frontend-doc-policy";
import { getFrontendContentSlug } from "@/lib/frontend-page-content";
import { getDocsFolder, getDocsMode, getIntegrations } from "@/lib/registry";
import { renderPageToLlmText } from "@/lib/llm-text";
import { GET } from "./route";

// `loadDoc` is mocked so each case controls which files "exist"; the
// resolution ORDER is the real shared implementation, because these tests
// assert that order and a stubbed one would make them vacuous.
vi.mock("@/lib/docs-render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/docs-render")>();
  return {
    loadDoc: vi.fn(),
    docCandidateOrder: actual.docCandidateOrder,
    FRAMEWORK_WINS_SLUGS: actual.FRAMEWORK_WINS_SLUGS,
  };
});

vi.mock("@/lib/frontend-doc-policy", () => ({
  resolveFrontendDocPage: vi.fn(),
  isFrontendFirstClassDoc: vi.fn(() => true),
}));

vi.mock("@/lib/frontend-page-content", () => ({
  getFrontendContentSlug: vi.fn((id: string) => `frontends/${id}`),
  getFrontendGuidanceContentSlug: vi.fn(() => "frontends/docs-status"),
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
});
