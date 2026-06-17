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
  AUTH_BANNER_UNAUTHENTICATED_SELECTOR,
  ERROR_BANNER_SELECTOR,
  ERROR_BOUNDARY_SELECTOR,
} from "./d5-auth.js";

interface FakeOpts {
  /** Whether the SignInCard's sign-in button is visible at preFill time
   *  (idiomatic shape detection). Default true (langgraph-python). */
  signInButtonVisible?: boolean;
  /** Whether the chat textarea mounts after sign-in click. Default true. */
  textareaMountsAfterSignIn?: boolean;
  /** Whether the sign-out button is visible after authentication. Default true. */
  signOutButtonVisible?: boolean;
  /** Whether the SignInCard re-mounts after sign-out (idiomatic-shape pass). */
  signInCardRemounts?: boolean;
  /** Whether the legacy banner flips to unauthenticated after sign-out. */
  legacyBannerFlipsToUnauth?: boolean;
  /** Whether the legacy error surface eventually appears. */
  legacyErrorSurfaceAppears?: boolean;
}

function makePage(opts: FakeOpts): {
  page: Page;
  fakeClick: (p: Page, sel: string) => Promise<void>;
} {
  let signedIn = !opts.signInButtonVisible; // legacy starts already-signed-in
  let signedOut = false;
  const page: Page = {
    async waitForSelector(selector: string) {
      if (selector === SIGN_IN_BUTTON_SELECTOR) {
        if (!(opts.signInButtonVisible ?? true)) {
          throw new Error(
            "waitForSelector timeout (legacy shape — no sign-in button)",
          );
        }
        return;
      }
      // The chat-input cascade selector used by the preFill hook.
      if (
        selector.includes("copilot-chat-textarea") ||
        selector === "textarea"
      ) {
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
      if (selector === AUTH_BANNER_UNAUTHENTICATED_SELECTOR) {
        if (!signedOut || !(opts.legacyBannerFlipsToUnauth ?? false)) {
          throw new Error(
            "waitForSelector timeout (legacy banner never flipped)",
          );
        }
        return;
      }
    },
    async fill() {},
    async press() {},
    async evaluate() {
      // probeErrorSurfaceVisible asks for `[data-testid="auth-demo-error"]`
      // OR `[data-testid="auth-demo-chat-boundary"]` — return true after
      // sign-out if the legacy error surface should appear.
      return (signedOut && (opts.legacyErrorSurfaceAppears ?? false)) as never;
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
    expect(SIGN_IN_BUTTON_SELECTOR).toBe('[data-testid="auth-sign-in-button"]');
    expect(SIGN_IN_CARD_SELECTOR).toBe('[data-testid="auth-sign-in-card"]');
    expect(SIGN_OUT_BUTTON_SELECTOR).toBe(
      '[data-testid="auth-sign-out-button"]',
    );
    expect(AUTH_BANNER_UNAUTHENTICATED_SELECTOR).toBe(
      '[data-testid="auth-banner"][data-authenticated="false"]',
    );
    expect(ERROR_BANNER_SELECTOR).toBe('[data-testid="auth-demo-error"]');
    expect(ERROR_BOUNDARY_SELECTOR).toBe(
      '[data-testid="auth-demo-chat-boundary"]',
    );
  });

  describe("buildAuthPreFill", () => {
    it("on idiomatic shape: clicks sign-in then waits for chat textarea", async () => {
      const { page, fakeClick } = makePage({
        signInButtonVisible: true,
        textareaMountsAfterSignIn: true,
      });
      const preFill = buildAuthPreFill({
        click: fakeClick,
        detectTimeoutMs: 50,
      });
      await expect(preFill(page)).resolves.toBeUndefined();
    });

    it("on idiomatic shape: fails when chat textarea does not mount after sign-in", async () => {
      const { page, fakeClick } = makePage({
        signInButtonVisible: true,
        textareaMountsAfterSignIn: false,
      });
      const preFill = buildAuthPreFill({
        click: fakeClick,
        detectTimeoutMs: 50,
      });
      await expect(preFill(page)).rejects.toThrow(
        /chat textarea did not mount/,
      );
    });

    it("on legacy shape: returns immediately (no sign-in click needed)", async () => {
      // No sign-in button visible → legacy shape → preFill is a no-op.
      const { page, fakeClick } = makePage({ signInButtonVisible: false });
      const preFill = buildAuthPreFill({
        click: fakeClick,
        detectTimeoutMs: 50,
      });
      await expect(preFill(page)).resolves.toBeUndefined();
    });
  });

  describe("buildAuthAssertion", () => {
    it("fails when sign-out button is not visible", async () => {
      const { page, fakeClick } = makePage({ signOutButtonVisible: false });
      const assertion = buildAuthAssertion({
        signOutTimeoutMs: 50,
        detectTimeoutMs: 50,
        click: fakeClick,
      });
      await expect(assertion(page)).rejects.toThrow(
        /sign-out button.*not visible/,
      );
    });

    it("on idiomatic shape: succeeds when SignInCard re-mounts after sign-out", async () => {
      const { page, fakeClick } = makePage({
        signInButtonVisible: true,
        signOutButtonVisible: true,
        signInCardRemounts: true,
      });
      const assertion = buildAuthAssertion({
        signOutTimeoutMs: 5_000,
        detectTimeoutMs: 50,
        click: fakeClick,
      });
      await expect(assertion(page)).resolves.toBeUndefined();
    });

    it("on legacy shape: succeeds when banner flips and error surface appears", async () => {
      const { page, fakeClick } = makePage({
        signInButtonVisible: false, // legacy
        signOutButtonVisible: true,
        signInCardRemounts: false, // legacy doesn't have SignInCard
        legacyBannerFlipsToUnauth: true,
        legacyErrorSurfaceAppears: true,
      });
      const assertion = buildAuthAssertion({
        signOutTimeoutMs: 5_000,
        detectTimeoutMs: 50,
        click: fakeClick,
      });
      await expect(assertion(page)).resolves.toBeUndefined();
    });

    it("fails when neither idiomatic re-mount nor legacy banner-flip happens", async () => {
      const { page, fakeClick } = makePage({
        signOutButtonVisible: true,
        signInCardRemounts: false,
        legacyBannerFlipsToUnauth: false,
      });
      const assertion = buildAuthAssertion({
        signOutTimeoutMs: 100,
        detectTimeoutMs: 50,
        click: fakeClick,
      });
      await expect(assertion(page)).rejects.toThrow(
        /neither idiomatic SignInCard re-mount nor legacy banner-flip/,
      );
    });

    it("fails when legacy banner flips but error surface never appears", async () => {
      const { page, fakeClick } = makePage({
        signInButtonVisible: false,
        signOutButtonVisible: true,
        signInCardRemounts: false,
        legacyBannerFlipsToUnauth: true,
        legacyErrorSurfaceAppears: false,
      });
      // signOutTimeoutMs MUST be large enough that the idiomatic-
      // detection window (Math.min(3_000, timeout)) doesn't consume
      // the entire budget — otherwise the assertion fails with
      // "idiomatic detection consumed the budget" before the legacy
      // path runs. 4s gives idiomatic 3s + ~1s of budget for the
      // legacy banner-flip + fill + press + error-surface poll.
      const assertion = buildAuthAssertion({
        signOutTimeoutMs: 4_000,
        detectTimeoutMs: 50,
        click: fakeClick,
      });
      await expect(assertion(page)).rejects.toThrow(
        /legacy shape.*neither.*appeared/,
      );
    });

    it("fails fast with 'idiomatic detection consumed the budget' when caller passes a tight timeout", async () => {
      const { page, fakeClick } = makePage({
        signInButtonVisible: false,
        signOutButtonVisible: true,
        signInCardRemounts: false,
        legacyBannerFlipsToUnauth: true,
        legacyErrorSurfaceAppears: false,
      });
      // With a tight 100ms budget, the idiomatic-detection window
      // (Math.min(3_000, 100) = 100ms) consumes the entire budget;
      // the legacy fallback should bail immediately rather than
      // pushing through more hardcoded sub-timeouts.
      const assertion = buildAuthAssertion({
        signOutTimeoutMs: 100,
        detectTimeoutMs: 50,
        click: fakeClick,
      });
      await expect(assertion(page)).rejects.toThrow(
        /idiomatic detection consumed the budget/,
      );
    });
  });
});
