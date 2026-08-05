import { afterEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

afterEach(() => {
  redirect.mockClear();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function renderRootIndex() {
  // Fresh import per case: the module reads the env at call time, but resetting
  // modules keeps each case independent of import order.
  const { default: RootIndex } = await import("./page");
  RootIndex();
}

describe("RootIndex", () => {
  it("sends / to the default skin when unlocked", async () => {
    vi.stubEnv("LOCK_SKIN", "");
    await renderRootIndex();
    expect(redirect).toHaveBeenCalledWith("/banking");
  });

  it("sends / to the LOCKED skin when locked", async () => {
    // Without this, a locked deploy's root would land on defaultSkinId and then
    // immediately 404 — the front door of the demo, broken.
    vi.stubEnv("LOCK_SKIN", "airline");
    await renderRootIndex();
    expect(redirect).toHaveBeenCalledWith("/airline");
  });

  it("forces dynamic rendering so LOCK_SKIN is read per request", async () => {
    // Removing this export silently re-bakes the build-time LOCK_SKIN into `/`:
    // reading process.env is not a dynamic API, so without force-dynamic Next
    // statically prerenders `/` and freezes the redirect target at build time.
    const page = await import("./page");
    expect(page.dynamic).toBe("force-dynamic");
  });
});
