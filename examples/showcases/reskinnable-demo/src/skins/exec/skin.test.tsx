import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

// The real send drives the LIVE composer through `@/shell/attach` — it locates
// a textarea, stages bytes into a hidden input and clicks send, reporting
// every failure through `window.alert`. None of that exists here, and the
// assertion below is about WHICH pill is intercepted, not about the chain.
// `MEMO_NARRATIVE_MESSAGE` is imported straight from `./suggestions` (not
// through this mock) so it stays the real constant regardless — a drifted
// pill still fails. Mirrors `src/skins/airline/skin.test.tsx`.
const sent = vi.fn(() => Promise.resolve(true));
// The header action's own dependency, spied for the same reason as `sent`: a
// pill or button that claims a click without running anything is the failure
// mode both of these exist to catch.
const attachedByHand = vi.fn(() => Promise.resolve(true));
vi.mock("@/skins/exec/attach-memo", async (importOriginal) => {
  // `importOriginal` keeps any other real exports intact. Only the two
  // functions that touch the DOM are replaced. Spread through a plain record
  // rather than an `import()` type annotation, which the repo's lint forbids.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendMemoWithAttachment: () => sent(),
    attachMemoByHand: () => attachedByHand(),
  };
});

// ── The chrome's own dependencies, for the `<ExecLayout>` cases below ───────
// `layout.tsx` is the only part of this skin that OWNS a failure surface (the
// help pill's run, and the presenter reset), so it is exercised here rather
// than left to e2e. Everything it reaches for — the router, the runtime, the
// ledger — is replaced; what is under test is what the layout DOES when one of
// those rejects, not the machinery itself.
const chrome = vi.hoisted(() => ({
  runAgent: vi.fn<(input: unknown) => Promise<void>>(() => Promise.resolve()),
  resetDemo: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  addMessage: vi.fn(),
  setModalOpen: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/exec" }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The real toggle reads `localStorage` and `matchMedia` on mount; neither is
// what these cases are about, and a plain button keeps the tree deterministic.
vi.mock("@/components/ui/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Toggle theme</button>,
}));
// Spread the original so every OTHER v2 export this skin's modules import
// (tools.tsx, the pages) stays real — only the four hooks the layout calls are
// replaced.
vi.mock("@copilotkit/react-core/v2", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAgent: () => ({ agent: { addMessage: chrome.addMessage } }),
  useAgentContext: () => {},
  useCopilotChatConfiguration: () => ({ setModalOpen: chrome.setModalOpen }),
  useCopilotKit: () => ({ copilotkit: { runAgent: chrome.runAgent } }),
}));
// `ResetDemoError` must stay the REAL class — the layout narrows on it with
// `instanceof`, so a stand-in would make the 403 case below vacuously green.
vi.mock("@/skins/exec/data/ledger-context", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useExecLedger: () => ({ resetDemo: chrome.resetDemo }),
}));

import type { ReactNode } from "react";
import exec from "@/skins/exec/skin";
import { ExecLayout } from "@/skins/exec/layout";
import { ResetDemoError } from "@/skins/exec/data/ledger-context";
import { PresenterResetProvider } from "@/shell/presenter-reset-context";
import { SkinProvider } from "@/shell/skin-provider";
import {
  CeoDashboardPage,
  CfoDashboardPage,
  MetricsExplorerPage,
  BoardPacksPage,
} from "@/skins/exec/pages";
import { MEMO_NARRATIVE_MESSAGE } from "@/skins/exec/suggestions";

/**
 * `resolvePage` maps URL segments (untrusted caller input) to a page. A plain
 * object indexed by the joined segments walks the prototype chain, so these
 * keys all resolve to a truthy `Function` (or, for `__proto__`,
 * `Object.prototype`) that slips past the shell's `if (!Page) notFound()`
 * guard in `src/app/[skin]/[[...rest]]/page.tsx` and is rendered as a
 * `ComponentType` — a 500 instead of a 404. The `Map`-backed lookup in
 * `./pages/index.ts` must return `null` for every one. Mirrors
 * `src/skins/airline/skin.test.tsx` and commerce's.
 */
const PROTOTYPE_CHAIN_KEYS = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
  "__defineGetter__",
];

// The module-level spies above are SHARED by every case in this file, and
// `sent`/`attachedByHand` are both asserted with exact call COUNTS. Without
// this, a second case that touches the same pill inherits the first case's
// tally and the count assertions stop meaning what they say. `restoreAllMocks`
// additionally undoes the `vi.spyOn(window, …)` stubs the layout cases install,
// so `window.alert`/`confirm` never leak a stub into a later suite.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("exec resolvePage", () => {
  it("resolves every real page segment to its component", () => {
    expect(exec.resolvePage([])).toBe(CeoDashboardPage);
    expect(exec.resolvePage(["finance"])).toBe(CfoDashboardPage);
    expect(exec.resolvePage(["metrics"])).toBe(MetricsExplorerPage);
    expect(exec.resolvePage(["packs"])).toBe(BoardPacksPage);
  });

  it("covers every nav segment, so no nav entry can 404", () => {
    expect(exec.nav.length).toBeGreaterThanOrEqual(4);
    for (const route of exec.nav) {
      expect(
        exec.resolvePage(route.segment ? [route.segment] : []),
        `nav lists "${route.segment}" but resolvePage 404s it`,
      ).not.toBeNull();
    }
  });

  it("returns null (404) for an unknown segment", () => {
    expect(exec.resolvePage(["nope"])).toBeNull();
    expect(exec.resolvePage(["finance", "extra"])).toBeNull();
  });

  it.each(PROTOTYPE_CHAIN_KEYS)(
    "returns null (404) for prototype-chain key %j, never a Function component",
    (key) => {
      expect(exec.resolvePage([key])).toBeNull();
    },
  );
});

describe("exec skin wiring", () => {
  it("keeps the agent out of the client bundle", () => {
    // `@copilotkit/runtime` must never reach the browser. The only link
    // between a skin and its agent is the shared id — see this file's own
    // NOTE in `skin.tsx` about why `agent` must never appear here.
    expect(exec.id).toBe("exec");
    expect("agent" in exec).toBe(false);
    expect(exec.themeClass).toBe("theme-exec");
  });

  // The fields below rode along unguarded. `sandboxFunctions` and `toolLabels`
  // are OPTIONAL on the `Skin` contract (legitimately absent for some other
  // skin), so dropping either type checks, lints and renders — it just silently
  // unbuilds a beat. `catalog` and `designSkill` are REQUIRED, so the compiler
  // catches a deletion; what it cannot catch is the EMPTY one that satisfies
  // the type and renders nothing, which is what these cases are actually for.
  // Keel pins the same class of field for the same reason
  // (`src/skins/keel/skin.test.tsx`'s "the keel skin object").
  it("carries the a2ui catalog its blocks render through", () => {
    // An EMPTY catalog is the failure the type cannot see: the inline dashboard
    // blocks (beats 3a/5) then have no renderers and the chat shows raw a2ui
    // ops. `includeBasicCatalog: false` means every component in here is one
    // this skin registered (`./catalog/index.ts`).
    expect(exec.catalog.components.size).toBeGreaterThan(0);
  });

  it("exposes sandbox functions, so OGUI stays bound to the real ledger", () => {
    // `generateSandboxedUi` with no exposed functions produces a view that
    // INVENTS its figures — the one failure the design brief forbids outright.
    expect(exec.sandboxFunctions?.length).toBeGreaterThan(0);
  });

  it("labels every tool the beats fire", () => {
    // An unlabelled tool falls back to a prettified raw name, which on stage
    // reads as the one tool nobody bothered to name.
    for (const name of [
      "offerWorkflowRecording",
      "awaitDemonstration",
      "saveLearnedProcedure",
      "confirmPublishCountersign",
      "navigateTo",
      "pinBlockToDashboard",
      "generateSandboxedUi",
    ]) {
      expect(
        exec.toolLabels?.[name],
        `${name} has no tool label`,
      ).toBeDefined();
    }
  });

  it("keeps the OGUI brief free of host CSS custom properties", () => {
    // The sandbox iframe ships a bare CSS reset — no `globals.css`, no
    // Tailwind, no `.theme-exec` ancestor — so a brief that tells the model to
    // "read colors from the CSS variables" yields `var(--surface)` against an
    // empty cascade: transparent panels and default-black text. Literal values
    // only. See `design-skill.ts`'s own doc comment.
    expect(exec.designSkill).toBeDefined();
    expect(exec.designSkill).not.toMatch(/var\(--/);
    expect(exec.designSkill).not.toMatch(/`--(surface|canvas|ink|brand)/);
    // And it must still SAY something about color, or the guard above is
    // satisfied by an empty brief.
    expect(exec.designSkill).toMatch(/hsl\(/);
  });
});

describe("exec beat 3d — the attachment path", () => {
  it("stages the department budget memo from the chat header", () => {
    expect(exec.chatHeaderActions).toHaveLength(1);
    const action = exec.chatHeaderActions?.[0];
    expect(action?.label).toMatch(/budget memo/i);

    // THE CLICK, ACTUALLY INVOKED. The label and the count were the whole
    // test, so an `onClick` wired to nothing — or to the wrong function —
    // passed it. This is the presenter's manual fallback for beat 3d: if it
    // does not reach `attachMemoByHand`, the button is decoration and the
    // fallback does not exist.
    expect(typeof action?.onClick).toBe("function");
    action?.onClick();
    expect(attachedByHand).toHaveBeenCalledTimes(1);
  });

  it("intercepts ONLY the pill whose message carries the attachment", () => {
    // The default suggestion path DROPS attachments, so this pill must be
    // intercepted — and every other pill must NOT be, or the shell stops
    // sending them at all.
    expect(
      exec.onSuggestionSelect?.(
        { title: "x", message: MEMO_NARRATIVE_MESSAGE },
        0,
      ),
    ).toBe(true);
    // Claiming the click is only honest if the send actually ran: `true` plus
    // silence is a pill that does nothing at all.
    expect(sent).toHaveBeenCalledTimes(1);
    expect(
      exec.onSuggestionSelect?.({ title: "y", message: "anything else" }, 1),
    ).toBe(false);
    expect(sent).toHaveBeenCalledTimes(1);
  });
});

/**
 * THE CHROME'S FAILURE SURFACES.
 *
 * Both controls in the sidebar's meta-utility strip fire an async call that can
 * reject, and a rejection the operator cannot SEE is the same as no error
 * handling at all: the help pill's message sits in the thread unanswered
 * forever, and a refused reset reads as a reset that worked. Each case below
 * rejects one call and asserts the operator is told.
 */
function renderLayout({ resetEnabled = false } = {}) {
  return render(
    <PresenterResetProvider enabled={resetEnabled}>
      <SkinProvider skin={exec}>
        <ExecLayout>
          <p>page</p>
        </ExecLayout>
      </SkinProvider>
    </PresenterResetProvider>,
  );
}

describe("exec layout — the help pill's failure surface", () => {
  it("shows a dismissible error naming the failure when runAgent rejects", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    chrome.runAgent.mockRejectedValueOnce(new Error("runtime unreachable"));
    renderLayout();

    await act(async () => {
      screen.getByLabelText("Ask the copilot for help").click();
    });

    // The message was posted into the thread, so silence here leaves a user
    // turn sitting there with nothing ever coming back.
    expect(chrome.addMessage).toHaveBeenCalledTimes(1);
    const surfaced = await screen.findByTestId("exec-chrome-error");
    expect(surfaced.textContent).toContain("runtime unreachable");
    // Still logged for the console-diving case; the surface is IN ADDITION.
    expect(consoleError).toHaveBeenCalled();

    // And it can be dismissed, exactly like the ledger's stale-view banner.
    await act(async () => {
      screen.getByRole("button", { name: /dismiss/i }).click();
    });
    await waitFor(() =>
      expect(screen.queryByTestId("exec-chrome-error")).toBeNull(),
    );
  });

  it("shows nothing while the run succeeds", async () => {
    renderLayout();
    await act(async () => {
      screen.getByLabelText("Ask the copilot for help").click();
    });
    expect(screen.queryByTestId("exec-chrome-error")).toBeNull();
  });
});

describe("exec layout — the presenter reset's failure surface", () => {
  function armReset() {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    return vi.spyOn(window, "alert").mockImplementation(() => {});
  }

  it("names the FORBIDDEN refusal instead of reporting a generic failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const alerted = armReset();
    // What `dev/reset`'s gate actually answers: 403 with `{ error: "FORBIDDEN" }`
    // and NO `reset` array, because the refusal happened before `store.reset()`
    // — see `src/app/api/exec/v1/dev/reset/route.ts`.
    chrome.resetDemo.mockRejectedValueOnce(
      new ResetDemoError("reset demo failed: 403", { error: "FORBIDDEN" }),
    );
    renderLayout({ resetEnabled: true });

    await act(async () => {
      screen.getByLabelText("Reset demo state").click();
    });

    // A refusal that touched nothing must not read as "reset failed" — that
    // sends the presenter hunting a bug instead of a disabled flag.
    const message = String(alerted.mock.calls[0]?.[0] ?? "");
    expect(message).toMatch(/not (enabled|allowed)|disabled|refused/i);
    expect(message).toMatch(/nothing (was )?(changed|reset)/i);
    // The catch used to log NOTHING, so the only trace of a refused reset was
    // the alert the operator had already dismissed.
    expect(consoleError).toHaveBeenCalled();
  });

  it("still logs, and reports plainly, for an unrecognised failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const alerted = armReset();
    chrome.resetDemo.mockRejectedValueOnce(new Error("network down"));
    renderLayout({ resetEnabled: true });

    await act(async () => {
      screen.getByLabelText("Reset demo state").click();
    });

    expect(String(alerted.mock.calls[0]?.[0] ?? "")).toContain("network down");
    expect(consoleError).toHaveBeenCalled();
  });
});
