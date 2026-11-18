import { describe, expect, it, vi } from "vitest";

/**
 * The bulletin staging helpers drive the REAL chat composer and report every
 * failure through `console.error` AND `window.alert`. Neither exists in this
 * test's DOM, so they are replaced: what is under test here is the SKIN's
 * dispatch (which pill it claims, and that it claims nothing else), not the
 * shell's attachment machinery — that is covered by
 * `src/shell/attach/stage-attachment.test.ts`.
 */
const attach = vi.hoisted(() => ({
  byHand: vi.fn(() => Promise.resolve(true)),
  sendMessage: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/skins/keel/attach-bulletin", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  attachBulletinByHand: attach.byHand,
  sendBulletinMessage: attach.sendMessage,
}));

import keel from "@/skins/keel/skin";
import { BULLETIN_MESSAGE } from "@/skins/keel/attach-bulletin";
import { DeskPage } from "@/skins/keel/pages/desk";
import { KnowledgePage } from "@/skins/keel/pages/knowledge";
import { PlaybooksPage } from "@/skins/keel/pages/playbooks";
import { RunsPage } from "@/skins/keel/pages/runs";
import { DocumentPage } from "@/skins/keel/pages/document";
import { RunDetailPage } from "@/skins/keel/pages/run-detail";

/**
 * `resolvePage` maps URL segments (untrusted caller input) to a page. A plain
 * object indexed by `segments[0]` walks the prototype chain, so these keys all
 * resolve to a truthy `Function` that slips past the `?? null` 404 guard and is
 * handed to the shell as a `ComponentType` — a React crash instead of a 404.
 * The `Map`-backed lookup must return `null` (a clean 404) for every one.
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

describe("keel resolvePage", () => {
  it("resolves the known single-segment routes to their page", () => {
    expect(keel.resolvePage([])).toBe(DeskPage);
    expect(keel.resolvePage(["knowledge"])).toBe(KnowledgePage);
    expect(keel.resolvePage(["playbooks"])).toBe(PlaybooksPage);
    expect(keel.resolvePage(["runs"])).toBe(RunsPage);
  });

  it("resolves the parameterized detail routes without existence checks", () => {
    expect(keel.resolvePage(["knowledge", "any-doc-id"])).toBe(DocumentPage);
    expect(keel.resolvePage(["runs", "any-run-id"])).toBe(RunDetailPage);
  });

  it("returns null (404) for an unknown single segment", () => {
    expect(keel.resolvePage(["nope"])).toBeNull();
  });

  it("returns null (404) for unknown or too-deep parameterized routes", () => {
    expect(keel.resolvePage(["unknown", "x"])).toBeNull();
    expect(keel.resolvePage(["knowledge", "a", "b"])).toBeNull();
  });

  it.each(PROTOTYPE_CHAIN_KEYS)(
    "returns null (404) for prototype-chain key %j, never a Function component",
    (key) => {
      expect(keel.resolvePage([key])).toBeNull();
    },
  );
});

/**
 * THE MOUNTED SKIN OBJECT.
 *
 * `agent-registry.ts` has no drift guard and neither does most of the contract:
 * a skin can be wired everywhere the type checker looks and still be missing the
 * one field a beat needs, because every optional field on `Skin` is legitimately
 * absent for some other skin. These assertions are about the fields keel's beats
 * DEPEND on — each one has a beat named beside it, so a future edit that drops
 * one fails with the reason rather than with "expected defined".
 */
describe("the keel skin object", () => {
  it("no longer registers useData — runs live in the REST ledger", () => {
    // `data/use-data.ts` is gone. Keel was one of the two in-memory skins;
    // `useKeelData` held runs in `useState` and advanced them on a 900ms client
    // interval, which became the second clock the moment the pages moved onto
    // `GET /ledger`. Time now lives on the server. A `useData` reappearing here
    // means somebody put the second clock back.
    expect(keel.useData).toBeUndefined();
  });

  it("mounts RuntimeProviders and contributes runtime properties", () => {
    // The ledger provider is mounted INSIDE RuntimeProviders, so everything
    // below the CopilotKit provider reads one snapshot (beat 3b).
    expect(keel.RuntimeProviders).toBeDefined();
    expect(keel.useRuntimeProperties).toBeDefined();
  });

  it("keeps its report canvas (beats 3d and the ops report)", () => {
    expect(keel.CanvasSurface).toBeDefined();
  });

  it("offers the bulletin paperclip in the chat header (beat 3d)", () => {
    expect(keel.chatHeaderActions).toHaveLength(1);
    expect(keel.chatHeaderActions?.[0].label).toContain("bulletin");
    keel.chatHeaderActions?.[0].onClick();
    expect(attach.byHand).toHaveBeenCalled();
  });

  it("claims ONLY the bulletin pill, and drives the real composer for it", () => {
    // The default suggestion path DROPS attachments, so this pill must be
    // intercepted or the model invents the bulletin's contents and files a
    // durable brief that proves the opposite of the beat.
    const claimed = keel.onSuggestionSelect?.(
      { title: "Read this bulletin", message: BULLETIN_MESSAGE },
      0,
    );
    expect(claimed).toBe(true);
    expect(attach.sendMessage).toHaveBeenCalled();

    // Every other pill takes the default send path untouched.
    expect(
      keel.onSuggestionSelect?.(
        { title: "Other", message: "Anything else" },
        1,
      ),
    ).toBe(false);
  });

  it("labels every tool the beats fire, including the new ones", () => {
    // An unlabelled tool falls back to a prettified raw name, which on stage
    // reads as the one tool nobody bothered to name.
    for (const name of [
      "search_knowledge",
      "render_ops_report",
      "render_impact_brief",
      "showRegisterHealth",
      "countersignRelease",
      "fileImpactBrief",
      "showSources",
      "showPlaybook",
      "startRun",
      "showRun",
      "approveStep",
      "showApprovals",
      "openDocument",
      "navigateTo",
    ]) {
      expect(
        keel.toolLabels?.[name],
        `${name} has no tool label`,
      ).toBeDefined();
    }
  });
});
