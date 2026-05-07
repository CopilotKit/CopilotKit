import { describe, it, expect } from "vitest";
import { getD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildAuthAssertion,
  buildAuthPreFill,
  SIGN_IN_BUTTON_SELECTOR,
  SIGN_IN_CARD_SELECTOR,
  SIGN_OUT_BUTTON_SELECTOR,
} from "./d5-auth.js";

interface FakeOpts {
  /** Whether the sign-in button is initially visible. Default true. */
  signInButtonVisible?: boolean;
  /** Whether the chat textarea mounts after sign-in. Default true. */
  textareaMountsAfterSignIn?: boolean;
  /** Whether the sign-out button is visible after authentication. Default true. */
  signOutButtonVisible?: boolean;
  /** Whether the SignInCard re-mounts after sign-out. Default true. */
  signInCardRemounts?: boolean;
}

function makePage(opts: FakeOpts): {
  page: Page;
  fakeClick: (p: Page, sel: string) => Promise<void>;
} {
  let signedIn = false;
  let signedOut = false;
  const page: Page = {
    async waitForSelector(selector: string) {
      if (selector === SIGN_IN_BUTTON_SELECTOR) {
        if (!(opts.signInButtonVisible ?? true)) {
          throw new Error("waitForSelector timeout (sign-in button missing)");
        }
        return;
      }
      // The chat-input cascade selector used by the preFill hook.
      if (selector.includes("copilot-chat-textarea") || selector === "textarea") {
        if (!signedIn) {
          throw new Error(
            "waitForSelector timeout (chat textarea not mounted before sign-in)",
          );
        }
        if (!(opts.textareaMountsAfterSignIn ?? true)) {
          throw new Error(
            "waitForSelector timeout (chat textarea did not mount)",
          );
        }
        return;
      }
      if (selector === SIGN_OUT_BUTTON_SELECTOR) {
        if (!(opts.signOutButtonVisible ?? true)) {
          throw new Error("waitForSelector timeout (sign-out button missing)");
        }
        return;
      }
      if (selector === SIGN_IN_CARD_SELECTOR) {
        if (!signedOut || !(opts.signInCardRemounts ?? true)) {
          throw new Error(
            "waitForSelector timeout (SignInCard did not re-mount)",
          );
        }
        return;
      }
    },
    async fill() {},
    async press() {},
    async evaluate() {
      return undefined as never;
    },
  };
  const fakeClick = async (_p: Page, sel: string): Promise<void> => {
    if (sel === SIGN_IN_BUTTON_SELECTOR) signedIn = true;
    if (sel === SIGN_OUT_BUTTON_SELECTOR) signedOut = true;
  };
  return { page, fakeClick };
}

describe("d5-auth script", () => {
  it("registers under featureType 'auth'", () => {
    const script = getD5Script("auth");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["auth"]);
    expect(script?.fixtureFile).toBe("auth.json");
  });

  it("buildTurns produces one turn with preFill and assertion", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "auth",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe("auth check turn 1");
    expect(typeof turns[0]!.preFill).toBe("function");
    expect(typeof turns[0]!.assertions).toBe("function");
  });

  it("exposes the sign-in, sign-out, and SignInCard selectors", () => {
    expect(SIGN_IN_BUTTON_SELECTOR).toBe(
      '[data-testid="auth-sign-in-button"]',
    );
    expect(SIGN_IN_CARD_SELECTOR).toBe('[data-testid="auth-sign-in-card"]');
    expect(SIGN_OUT_BUTTON_SELECTOR).toBe(
      '[data-testid="auth-sign-out-button"]',
    );
  });

  describe("buildAuthPreFill", () => {
    it("fails when sign-in button is not visible (demo loaded into wrong state)", async () => {
      const { page, fakeClick } = makePage({ signInButtonVisible: false });
      const preFill = buildAuthPreFill({ click: fakeClick });
      await expect(preFill(page)).rejects.toThrow(
        /sign-in button.*not visible/,
      );
    });

    it("fails when chat textarea does not mount after sign-in", async () => {
      const { page, fakeClick } = makePage({
        textareaMountsAfterSignIn: false,
      });
      const preFill = buildAuthPreFill({ click: fakeClick });
      await expect(preFill(page)).rejects.toThrow(
        /chat textarea did not mount/,
      );
    });

    it("succeeds when sign-in mounts the chat surface", async () => {
      const { page, fakeClick } = makePage({});
      const preFill = buildAuthPreFill({ click: fakeClick });
      await expect(preFill(page)).resolves.toBeUndefined();
    });
  });

  describe("buildAuthAssertion", () => {
    it("fails when sign-out button is not visible (sign-in path didn't authenticate)", async () => {
      const { page, fakeClick } = makePage({ signOutButtonVisible: false });
      const assertion = buildAuthAssertion({
        signOutTimeoutMs: 50,
        click: fakeClick,
      });
      await expect(assertion(page)).rejects.toThrow(
        /sign-out button.*not visible/,
      );
    });

    it("fails when SignInCard does not re-mount after sign-out (tree didn't unmount)", async () => {
      const { page, fakeClick } = makePage({ signInCardRemounts: false });
      const assertion = buildAuthAssertion({
        signOutTimeoutMs: 50,
        click: fakeClick,
      });
      await expect(assertion(page)).rejects.toThrow(/SignInCard.*did not re-mount/);
    });

    it("succeeds when SignInCard re-mounts after clicking sign-out", async () => {
      const { page, fakeClick } = makePage({});
      const assertion = buildAuthAssertion({ click: fakeClick });
      await expect(assertion(page)).resolves.toBeUndefined();
    });
  });
});
