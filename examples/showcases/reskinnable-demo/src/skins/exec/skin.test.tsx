import { describe, expect, it, vi } from "vitest";

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

import exec from "@/skins/exec/skin";
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
