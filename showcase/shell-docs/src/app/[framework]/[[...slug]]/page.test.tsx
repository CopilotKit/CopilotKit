import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: redirectMock,
}));

import FrameworkScopedDocsPage from "./page";

describe("FrameworkScopedDocsPage", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("redirects framework quickstart shims to the scoped React quickstart", async () => {
    await expect(
      FrameworkScopedDocsPage({
        params: Promise.resolve({
          framework: "langgraph-python",
          slug: ["quickstart"],
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/langgraph-python/quickstart/react");

    expect(redirectMock).toHaveBeenCalledWith(
      "/langgraph-python/quickstart/react",
    );
  });
});
