import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDoc } from "@/lib/docs-render";
import { getDocsFolder, getDocsMode, getIntegrations } from "@/lib/registry";
import { renderPageToLlmText } from "@/lib/llm-text";
import { GET } from "./route";

vi.mock("@/lib/docs-render", () => ({
  loadDoc: vi.fn(),
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
});
