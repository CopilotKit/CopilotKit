import { describe, expect, it } from "vitest";

import keel from "@/skins/keel/skin";
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
