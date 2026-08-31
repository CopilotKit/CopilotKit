import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { loadDoc } from "@/lib/docs-render";
import { getDocsFolder, getIntegration } from "@/lib/registry";
import { GET } from "./route";

vi.mock("next/og", () => ({
  ImageResponse: vi.fn(function MockImageResponse() {
    return new Response("png", {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    const error = new Error("not found") as Error & { digest: string };
    error.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
    throw error;
  }),
}));

// Default loadDoc behavior: only the bare `quickstart` slug resolves.
// Re-applied in beforeEach because individual tests install their own
// slug-keyed implementations and `vi.clearAllMocks()` does not restore
// the factory implementation.
const defaultLoadDoc = (slug: string) =>
  slug === "quickstart"
    ? {
        source: "",
        filePath: "quickstart.mdx",
        fm: {
          title: "Quickstart",
          description: "Build with CopilotKit.",
        },
      }
    : null;

vi.mock("@/lib/docs-render", () => ({
  loadDoc: vi.fn(),
}));

vi.mock("@/lib/registry", () => ({
  // Identity fallback mirrors the real helper (slug → folder of the
  // same name unless overridden).
  getDocsFolder: vi.fn((slug: string) => slug),
  getIntegration: vi.fn(() => null),
  ROOT_FRAMEWORK: "built-in-agent",
}));

const imageResponseMock = vi.mocked(ImageResponse);
const loadDocMock = vi.mocked(loadDoc);
const notFoundMock = vi.mocked(notFound);
const getDocsFolderMock = vi.mocked(getDocsFolder);
const getIntegrationMock = vi.mocked(getIntegration);

function callOgRoute(slug: string[]) {
  return GET(new Request("http://localhost:3003/og/test/og.png") as never, {
    params: Promise.resolve({ slug }),
  });
}

describe("shell-docs OG route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadDocMock.mockImplementation(defaultLoadDoc);
    imageResponseMock.mockImplementation(function MockImageResponse() {
      return new Response("png", {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
  });

  it("constructs a PNG response with canonical Plus Jakarta fonts", async () => {
    const response = await callOgRoute(["quickstart", "og.png"]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(imageResponseMock).toHaveBeenCalledOnce();

    const [, options] = imageResponseMock.mock.calls[0];
    expect(options?.width).toBe(1200);
    expect(options?.height).toBe(630);
    expect(options?.fonts).toHaveLength(2);
    expect(options?.fonts?.map((font) => font.name)).toEqual([
      "Plus Jakarta Sans",
      "Plus Jakarta Sans",
    ]);
    expect(options?.fonts?.map((font) => font.weight)).toEqual([500, 700]);
    expect(
      options?.fonts?.every((font) => font.data instanceof ArrayBuffer),
    ).toBe(true);
    expect(new Set(options?.fonts?.map((font) => font.data)).size).toBe(2);
  });

  it("keeps unknown slugs on the Next.js 404 path", async () => {
    await expect(callOgRoute(["missing", "og.png"])).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR"),
    });

    expect(loadDocMock).toHaveBeenCalledWith("missing");
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it("returns 500 when image rendering fails", async () => {
    imageResponseMock.mockImplementationOnce(function MockImageResponse() {
      throw new Error("render failed");
    });

    const response = await callOgRoute(["quickstart", "og.png"]);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("OG image generation failed");
  });

  it("still resolves framework-scoped docs before rendering", async () => {
    getIntegrationMock.mockReturnValueOnce({ name: "LangGraph" } as never);
    loadDocMock.mockImplementation((slug: string) =>
      slug === "integrations/langgraph/quickstart"
        ? {
            source: "",
            filePath: "integrations/langgraph/quickstart.mdx",
            fm: {
              title: "LangGraph Quickstart",
              description: "Framework scoped docs.",
            },
          }
        : null,
    );

    const response = await callOgRoute(["langgraph", "quickstart", "og.png"]);

    expect(response.status).toBe(200);
    expect(loadDocMock).toHaveBeenLastCalledWith(
      "integrations/langgraph/quickstart",
    );
    expect(getDocsFolderMock).toHaveBeenCalledWith("langgraph");
  });

  it("serves the root surface from the Built-in Agent override when one exists", async () => {
    // `/server-tools` has no bare root MDX — the BIA-authored page is
    // what the live route renders, so the OG image must read the same
    // file.
    loadDocMock.mockImplementation((slug: string) =>
      slug === "integrations/built-in-agent/server-tools"
        ? {
            source: "",
            filePath: "integrations/built-in-agent/server-tools.mdx",
            fm: {
              title: "Server Tools",
              description: "Define tools on the Built-in Agent.",
            },
          }
        : null,
    );

    const response = await callOgRoute(["server-tools", "og.png"]);

    expect(response.status).toBe(200);
    expect(loadDocMock).toHaveBeenCalledWith(
      "integrations/built-in-agent/server-tools",
    );
  });
});
