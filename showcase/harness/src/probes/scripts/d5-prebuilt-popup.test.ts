import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildPrebuiltPopupAssertion,
  POPUP_ROOT_SELECTOR,
} from "./d5-prebuilt-popup.js";

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

describe("d5-prebuilt-popup script", () => {
  it("registers under featureType 'prebuilt-popup'", () => {
    const script = getD5Script("prebuilt-popup");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["prebuilt-popup"]);
    expect(script?.fixtureFile).toBe("prebuilt-popup.json");
  });

  it("buildTurns input matches fixture", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "prebuilt-popup",
      baseUrl: "https://x.test",
    };
    expect(buildTurns(ctx)[0]!.input).toBe("hi from the popup test");
  });

  it("exposes the popup root selector", () => {
    expect(POPUP_ROOT_SELECTOR).toBe(".copilotKitPopup");
  });

  it("assertion fails when the popup root never appears", async () => {
    const assertion = buildPrebuiltPopupAssertion({
      rootTimeoutMs: 50,
      scopedTimeoutMs: 50,
    });
    await expect(assertion(makePage({ throwOnWait: true }))).rejects.toThrow(
      /popup root.*did not appear/,
    );
  });

  it("assertion fails when the popup is up but no message inside", async () => {
    const assertion = buildPrebuiltPopupAssertion({
      rootTimeoutMs: 50,
      scopedTimeoutMs: 50,
    });
    await expect(assertion(makePage({ messageInside: false }))).rejects.toThrow(
      /did not land inside/,
    );
  });

  it("assertion succeeds when popup is up and message lands inside", async () => {
    const assertion = buildPrebuiltPopupAssertion();
    await expect(
      assertion(makePage({ messageInside: true })),
    ).resolves.toBeUndefined();
  });
});
