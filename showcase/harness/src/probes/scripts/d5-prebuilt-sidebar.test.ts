import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildPrebuiltSidebarAssertion,
  SIDEBAR_ROOT_SELECTOR,
} from "./d5-prebuilt-sidebar.js";

function makePage(opts: {
  throwOnWait?: boolean;
  messageInside?: boolean;
}): Page {
  return {
    async waitForSelector() {
      if (opts.throwOnWait)
        throw new Error("waitForSelector timeout (test fake)");
    },
    async fill() {},
    async press() {},
    async evaluate() {
      return (opts.messageInside ?? false) as never;
    },
  };
}

describe("d5-prebuilt-sidebar script", () => {
  it("registers under featureType 'prebuilt-sidebar'", () => {
    const script = getD5Script("prebuilt-sidebar");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["prebuilt-sidebar"]);
    expect(script?.fixtureFile).toBe("prebuilt-sidebar.json");
  });

  it("buildTurns input matches fixture", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "prebuilt-sidebar",
      baseUrl: "https://x.test",
    };
    expect(buildTurns(ctx)[0]!.input).toBe("hi from the sidebar test");
  });

  it("exposes the sidebar root selector", () => {
    expect(SIDEBAR_ROOT_SELECTOR).toBe(".copilotKitSidebar");
  });

  it("assertion fails when the sidebar root never appears", async () => {
    const assertion = buildPrebuiltSidebarAssertion({
      rootTimeoutMs: 50,
      scopedTimeoutMs: 50,
    });
    await expect(assertion(makePage({ throwOnWait: true }))).rejects.toThrow(
      /sidebar root.*did not appear/,
    );
  });

  it("assertion fails when the sidebar root is present but no message inside", async () => {
    const assertion = buildPrebuiltSidebarAssertion({
      rootTimeoutMs: 50,
      scopedTimeoutMs: 50,
    });
    await expect(assertion(makePage({ messageInside: false }))).rejects.toThrow(
      /did not land inside/,
    );
  });

  it("assertion succeeds when sidebar root is up and message lands inside", async () => {
    const assertion = buildPrebuiltSidebarAssertion();
    await expect(
      assertion(makePage({ messageInside: true })),
    ).resolves.toBeUndefined();
  });
});
