import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mdxRemote: vi.fn(async ({ source }: { source: string }) => ({
    type: "article",
    props: { children: source },
  })),
}));

vi.mock("next-mdx-remote/rsc", () => ({ MDXRemote: mocks.mdxRemote }));

import { FrameworkSetup } from "../setup-concept";

beforeEach(() => {
  mocks.mdxRemote.mockClear();
});

// A snippet that is not bundled and a bundled snippet that fails to compile both left
// `FrameworkSetup` returning `null`, so a rendering defect shipped looking exactly like a
// deliberate omission — the only trace a `console.error` nobody reads in production
// (OSS-1036). Absence is a real state and stays quiet; a broken snippet is not.
//
// The unbundled case is pinned with a concept name that is deliberately never bundled,
// not with a framework slug. Naming a real gap made this test depend on that gap staying
// open: it was `ag2`, and closing the last nine `frontend-tools-setup` gaps (OSS-1036)
// would have turned it red for the right reason.
test("a concept nobody bundled for this framework renders nothing, quietly", async () => {
  const result = await FrameworkSetup({
    concept: "concept-that-is-never-bundled",
    currentFramework: "ag2",
  });

  expect(result).toBeNull();
  expect(mocks.mdxRemote).not.toHaveBeenCalled();
});

test("a bundled snippet that fails to compile is loud, not null", async () => {
  mocks.mdxRemote.mockRejectedValueOnce(new Error("Unexpected token"));

  await expect(
    FrameworkSetup({
      concept: "frontend-tools-setup",
      currentFramework: "google-adk",
    }),
  ).rejects.toThrow(/frontend-tools-setup.*google-adk/);
});
