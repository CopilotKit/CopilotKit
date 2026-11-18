// src/skins/bookstore/intelligence/user-id.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { SHOPPERS } from "../providers";
import {
  bookstoreIdentifyUser,
  bookstoreMemorySeedTargetUserIds,
  DEMO_DEFAULT_USER_ID,
  resolveBookstoreUserId,
  resolveBookstoreUserName,
  SEEDED_MEMORY_SHOPPER_ID,
  SEEDED_SHOPPER_IDS,
} from "./user-id";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("SEEDED_SHOPPER_IDS", () => {
  it("stays in step with the client shopper roster", () => {
    // user-id.ts is server-safe and cannot import the client providers module,
    // so the ids are duplicated. This test is the seam that keeps them honest.
    expect([...SEEDED_SHOPPER_IDS].sort()).toEqual(
      SHOPPERS.map((s) => s.id).sort(),
    );
  });

  it("names a seeded-memory shopper the resolver actually recognises", () => {
    // If this id stopped being a known shopper, `resolveBookstoreUserId` would
    // return the demo default for it and the seed-target set would silently
    // collapse to one bucket — losing the mapped-scope half of the seeding with
    // nothing to notice.
    expect(SEEDED_SHOPPER_IDS).toContain(SEEDED_MEMORY_SHOPPER_ID);
  });
});

describe("resolveBookstoreUserId", () => {
  it("scopes a known shopper 1:1, so two shoppers never share memory", () => {
    delete process.env.INTELLIGENCE_USER_ID;
    expect(resolveBookstoreUserId({ userId: "maya" })).toBe("bookstore-maya");
    expect(resolveBookstoreUserId({ userId: "guest" })).toBe("bookstore-guest");
  });

  it("falls back to the demo default for an unknown shopper", () => {
    delete process.env.INTELLIGENCE_USER_ID;
    // An unknown id must NOT mint a new scope: `userId` is client-forwarded and
    // therefore untrusted, and a spoofed id would create a memory bucket nothing
    // ever resets.
    expect(resolveBookstoreUserId({ userId: "__proto__" })).toBe(
      DEMO_DEFAULT_USER_ID,
    );
    expect(resolveBookstoreUserId({ userId: "constructor" })).toBe(
      DEMO_DEFAULT_USER_ID,
    );
    expect(resolveBookstoreUserId({})).toBe(DEMO_DEFAULT_USER_ID);
    expect(resolveBookstoreUserId()).toBe(DEMO_DEFAULT_USER_ID);
  });

  it("lets a pinned env id win, so CI stays deterministic", () => {
    process.env.INTELLIGENCE_USER_ID = "ci-pinned";
    expect(resolveBookstoreUserId({ userId: "maya" })).toBe("ci-pinned");
  });
});

describe("bookstoreMemorySeedTargetUserIds", () => {
  it("includes the DEFAULT bucket, which is where recall actually looks", () => {
    // The regression this guards is silent and total: the reset used to seed only
    // `bookstore-maya`, runs frequently resolve to the default bucket instead
    // (the client's `properties` often do not reach `identifyUser`), and
    // `recall_memory` then found NOTHING — so beat 4 produced no answer at all
    // rather than a generic one.
    delete process.env.INTELLIGENCE_USER_ID;
    const targets = bookstoreMemorySeedTargetUserIds();
    expect(targets).toContain(DEMO_DEFAULT_USER_ID);
    expect(targets).toContain(
      resolveBookstoreUserId({ userId: SEEDED_MEMORY_SHOPPER_ID }),
    );
  });

  it("leaves Guest's bucket unseeded", () => {
    // Deliberate — nothing needs to be written there. NOT because switching to
    // Guest demonstrates isolation: it does not re-scope memory at all.
    delete process.env.INTELLIGENCE_USER_ID;
    expect(bookstoreMemorySeedTargetUserIds()).not.toContain("bookstore-guest");
  });

  it("collapses to ONE bucket under a pinned env id, never a duplicate", () => {
    // Both entries resolve to the pinned value, and seeding it twice would
    // double-write every seed memory.
    process.env.INTELLIGENCE_USER_ID = "ci-pinned";
    expect(bookstoreMemorySeedTargetUserIds()).toEqual(["ci-pinned"]);
  });
});

describe("resolveBookstoreUserName", () => {
  it("names a known shopper", () => {
    delete process.env.INTELLIGENCE_USER_ID;
    expect(resolveBookstoreUserName({ userId: "maya" })).toBe("Maya Okonkwo");
    expect(resolveBookstoreUserName({ userId: "guest" })).toBe("Guest");
  });

  it("falls back for an unknown shopper", () => {
    delete process.env.INTELLIGENCE_USER_ID;
    expect(resolveBookstoreUserName({ userId: "nobody" })).toBe(
      "Bookstore Shopper",
    );
  });

  it("honours the pinned env name", () => {
    process.env.INTELLIGENCE_USER_ID = "ci-pinned";
    process.env.INTELLIGENCE_USER_NAME = "CI Shopper";
    expect(resolveBookstoreUserName({ userId: "maya" })).toBe("CI Shopper");
  });
});

describe("bookstoreIdentifyUser", () => {
  it("maps forwarded properties onto an id and a name", () => {
    delete process.env.INTELLIGENCE_USER_ID;
    expect(
      bookstoreIdentifyUser({ userId: "maya", userRole: "shopper" }),
    ).toEqual({ id: "bookstore-maya", name: "Maya Okonkwo" });
  });

  it("handles undefined properties without throwing", () => {
    delete process.env.INTELLIGENCE_USER_ID;
    expect(bookstoreIdentifyUser(undefined)).toEqual({
      id: DEMO_DEFAULT_USER_ID,
      name: "Bookstore Shopper",
    });
  });
});
