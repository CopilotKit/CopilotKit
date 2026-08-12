/**
 * THE MOUNTED SKIN OBJECT.
 *
 * Every field asserted here was, until this slot, either absent or pointed at a
 * substrate that no longer exists. That is the reason the file is worth having:
 * each of these is a ONE-LINE omission with NO runtime symptom in the place you
 * would look. `Providers` missing → `useAirlineLedger()` throws only when a page
 * that needs it renders. `CanvasSurface` missing → the canvas region opens and
 * draws nothing. `nav`/`resolvePage` still inline → `/airline/account` 404s while
 * everything else works. `useData` still set → the shell keeps running a second
 * seed of Camila's AV1423 that can contradict the ledger on stage.
 */
import { describe, expect, it, vi } from "vitest";

// The real send drives the LIVE composer through `@/shell/attach` — it locates a
// textarea, stages bytes into a hidden input and clicks send, reporting every
// failure through `window.alert`. None of that exists here, and the assertion
// below is about WHICH pill is intercepted, not about the chain. The message
// constant is deliberately the real one, so a drifted pill still fails.
const sent = vi.fn(() => Promise.resolve(true));
vi.mock(
  "@/skins/airline/attach-hotel-confirmation",
  async (importOriginal) => ({
    // `importOriginal` keeps the REAL `HOTEL_CONFIRMATION_MESSAGE`, so a pill whose
    // text drifts from the constant still fails this file. Only the two functions
    // that touch the DOM are replaced.
    ...(await importOriginal<
      typeof import("@/skins/airline/attach-hotel-confirmation")
    >()),
    sendHotelConfirmationMessage: () => sent(),
    attachHotelConfirmationByHand: () => Promise.resolve(true),
  }),
);

import airline from "@/skins/airline/skin";
import {
  AccountPage,
  DisruptionsPage,
  LoyaltyPage,
  RebookPage,
  TripsPage,
} from "@/skins/airline/pages";
import { AirlineProviders } from "@/skins/airline/providers";
import { AirlineCanvasSurface } from "@/skins/airline/canvas-surface";
import { HOTEL_CONFIRMATION_MESSAGE } from "@/skins/airline/attach-hotel-confirmation";

/**
 * `resolvePage` maps URL segments (untrusted caller input) to a page. A plain
 * object indexed by the joined segments walks the prototype chain, so these keys
 * all resolve to a truthy `Function` (or, for `__proto__`, `Object.prototype`)
 * that slips past the shell's `if (!Page) notFound()` guard in
 * `src/app/[skin]/[[...rest]]/page.tsx` and is rendered as a `ComponentType` —
 * a 500 instead of a 404. The `Map`-backed lookup must return `null` for every
 * one. Mirrors `src/skins/keel/skin.test.tsx` and commerce's.
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

describe("airline resolvePage", () => {
  it("resolves every real page segment to its component", () => {
    expect(airline.resolvePage([])).toBe(TripsPage);
    expect(airline.resolvePage(["account"])).toBe(AccountPage);
    expect(airline.resolvePage(["rebook"])).toBe(RebookPage);
    expect(airline.resolvePage(["loyalty"])).toBe(LoyaltyPage);
    expect(airline.resolvePage(["disruptions"])).toBe(DisruptionsPage);
  });

  it("covers every nav segment, so no nav entry can 404", () => {
    // The two REST-backed pages were unreachable for two commits while `nav`
    // already listed them — the sidebar linked to a 404 and nothing failed.
    expect(airline.nav.length).toBeGreaterThanOrEqual(5);
    for (const route of airline.nav) {
      expect(
        airline.resolvePage(route.segment ? [route.segment] : []),
        `nav lists "${route.segment}" but resolvePage 404s it`,
      ).not.toBeNull();
    }
  });

  it("returns null (404) for an unknown segment", () => {
    expect(airline.resolvePage(["nope"])).toBeNull();
    expect(airline.resolvePage(["account", "extra"])).toBeNull();
  });

  it.each(PROTOTYPE_CHAIN_KEYS)(
    "returns null (404) for prototype-chain key %j, never a Function component",
    (key) => {
      expect(airline.resolvePage([key])).toBeNull();
    },
  );
});

describe("airline skin wiring", () => {
  it("mounts the ledger provider stack", () => {
    // `useAirlineLedger()` THROWS outside its provider, deliberately — but only
    // when a page that calls it renders, which on a locked deploy is the first
    // click of the demo.
    expect(airline.Providers).toBe(AirlineProviders);
  });

  it("registers the Trip Brief canvas (beat 3d)", () => {
    // Without this the `render_trip_brief` tool result still becomes an
    // `a2ui-surface` activity, the shell still takes the region, and the region
    // renders NOTHING — a blank canvas on stage with no error anywhere.
    expect(airline.CanvasSurface).toBe(AirlineCanvasSurface);
  });

  it("retires `useData` — the REST ledger is the only substrate", () => {
    // It used to be `useAirlineData`, a second in-memory seed of AV1423. Two
    // substrates for one flight is a demo that can contradict itself live.
    expect(airline.useData).toBeUndefined();
  });

  it("keeps the agent out of the client bundle", () => {
    // `@copilotkit/runtime` must never reach the browser. The only link between
    // a skin and its agent is the shared id.
    expect(airline.id).toBe("airline");
    expect("agent" in airline).toBe(false);
    expect(airline.themeClass).toBe("theme-airline");
  });

  it("labels every tool it can render, so no chip shows a raw function name", () => {
    const labels = airline.toolLabels ?? {};
    for (const name of [
      "showTrips",
      "showRebookingSearch",
      "rebookOntoOption",
      "reseatPassenger",
      "notifyTripParty",
      "authorizeWithCardConfirmation",
      "fileFareException",
      "fileTripBrief",
      "render_trip_brief",
    ]) {
      expect(labels[name], `${name} has no activity-chip label`).toBeTruthy();
    }
  });
});

describe("airline beat 3d — the attachment path", () => {
  it("stages the hotel confirmation from the chat header", () => {
    expect(airline.chatHeaderActions).toHaveLength(1);
    expect(airline.chatHeaderActions?.[0]?.label).toMatch(
      /hotel confirmation/i,
    );
  });

  it("intercepts ONLY the pill whose message carries the attachment", () => {
    // The default suggestion path DROPS attachments, so this pill must be
    // intercepted — and every other pill must NOT be, or the shell stops
    // sending them at all.
    expect(
      airline.onSuggestionSelect?.(
        { title: "x", message: HOTEL_CONFIRMATION_MESSAGE },
        0,
      ),
    ).toBe(true);
    // Claiming the click is only honest if the send actually ran: `true` plus
    // silence is a pill that does nothing at all.
    expect(sent).toHaveBeenCalledTimes(1);
    expect(
      airline.onSuggestionSelect?.({ title: "y", message: "anything else" }, 1),
    ).toBe(false);
    expect(sent).toHaveBeenCalledTimes(1);
  });
});
