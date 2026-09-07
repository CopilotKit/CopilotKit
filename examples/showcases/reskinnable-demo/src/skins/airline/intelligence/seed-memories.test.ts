/**
 * The seed file is what makes "it already knows me" true, and every way it can be
 * wrong is silent: the app boots, the reset returns 200, and the beat simply does
 * not happen. Four properties are worth pinning.
 *
 *  1. Beat 6's procedure is ABSENT. Seed it and the concierge already knows the
 *     answer, never declines, never offers to record, and the teach arc disappears.
 *  2. Nothing here names a fare-exception CATEGORY. A seeded memory is recalled
 *     straight into the model's context, so this file is a leak channel for beat
 *     6's withheld vocabulary — the one the five-channel list in
 *     `failure-modes.md` § 10 does not mention, because it only exists once a skin
 *     seeds memories at all.
 *  3. Beat 5's procedure is `user`-scoped, not `project`. `forget-memories.ts`
 *     deliberately skips project rows (they belong to sibling skins sharing the
 *     backend), so a project-scoped procedure survives every presenter reset.
 *  4. The writes go to the right endpoint with the right identity header, and a
 *     rejection is COUNTED rather than thrown — a booth reset must still restore
 *     the trip record when the memory backend is unhappy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_MEMORIES, seedMemories } from "./seed-memories";

afterEach(() => vi.restoreAllMocks());

/** Every category in `data/fare-waiver-codes.ts`, restated so this file imports none. */
const WITHHELD_CATEGORIES = [
  "SCHEDULE_CHANGE_TRIGGERED",
  "MEDICAL_DOCUMENTED",
  "BEREAVEMENT_DOCUMENTED",
  "MILITARY_ORDERS",
  "CHANGED_PLANS",
  "FOUND_LOWER_FARE",
  "ELITE_COURTESY",
];

describe("airline seed memories — what is in the file", () => {
  it("seeds beat 4's standing preference as a topical user memory", () => {
    const topical = SEED_MEMORIES.filter((m) => m.kind === "topical");
    expect(topical).toHaveLength(1);
    const [preference] = topical;
    expect(preference.scope).toBe("user");
    // Four checkable clauses. A single-clause preference is too easy for the room
    // to read as a coincidence, and each of these has a field in the substrate.
    expect(preference.content).toMatch(/AISLE/);
    expect(preference.content).toMatch(/forward of the wing/i);
    expect(preference.content).toMatch(/NEVER put her in Basic Economy/i);
    expect(preference.content).toMatch(/America\/Santiago/);
    expect(preference.content).toMatch(/DISRUPTED/);
    // And the instruction that makes the beat VISIBLE.
    expect(preference.content).toMatch(/note/);
  });

  it("seeds beat 5's procedure as an OPERATIONAL memory naming its three writes", () => {
    const operational = SEED_MEMORIES.filter((m) => m.kind === "operational");
    expect(operational).toHaveLength(1);
    const [procedure] = operational;
    for (const write of [
      "rebookOntoOption",
      "reseatPassenger",
      "notifyTripParty",
    ]) {
      expect(procedure.content, `${write} is not in the procedure`).toContain(
        write,
      );
    }
    // The arguments come from `data/handling.ts` — the GIVEN vocabulary.
    expect(procedure.content).toContain("'aisle'");
    expect(procedure.content).toContain("'arrival-pickup'");
    expect(procedure.content).toContain("'new-arrival-time'");
    // It must run with no half-finished state: a confirmation card left unanswered
    // mid-procedure fails the NEXT message with "Tool result is missing for tool
    // call …", which poisons the whole thread.
    expect(procedure.content).toMatch(
      /without asking for\s*confirmation between them/i,
    );
    // BOOKING ID, not the confirmation code: AV7QK2 covers two of Camila's legs,
    // and an ambiguous reference changes nothing while reporting success.
    expect(procedure.content).toMatch(
      /BOOKING ID, never its\s*confirmation code/i,
    );
  });

  it("scopes the procedure to `user`, or the presenter reset cannot re-arm beat 6", () => {
    for (const memory of SEED_MEMORIES) {
      expect(memory.scope, `a ${memory.kind} memory is not user-scoped`).toBe(
        "user",
      );
    }
  });

  it("does NOT seed beat 6's procedure", () => {
    // The teach arc's whole premise. Any of these tokens in the seed means the
    // concierge starts the demo already knowing the answer.
    const all = SEED_MEMORIES.map((m) => m.content).join("\n");
    expect(all).not.toMatch(/fileFareException/);
    expect(all).not.toMatch(/offerWorkflowRecording/);
    // …and it says out loud that it is NOT that procedure, which is what stops the
    // model conflating the two on stage.
    const procedure = SEED_MEMORIES.find((m) => m.kind === "operational");
    expect(procedure?.content).toMatch(
      /NOT the procedure for a ticket whose FARE/i,
    );
    expect(procedure?.content).toMatch(/do not offer to record anything here/i);
  });

  it("names no fare-exception category anywhere", () => {
    const all = SEED_MEMORIES.map((m) => m.content).join("\n");
    for (const code of WITHHELD_CATEGORIES) {
      expect(all, `${code} is seeded straight into the prompt`).not.toContain(
        code,
      );
    }
    // Nor the prose forms of the four justifying grounds.
    expect(all).not.toMatch(
      /bereavement|military orders|physician|certificate/i,
    );
  });
});

describe("airline seed memories — how they are written", () => {
  const params = {
    apiUrl: "http://localhost:7250/",
    apiKey: "cpk_test",
    userId: "aeronova-camila-rojas",
  };

  it("POSTs one row per memory, scoped by the identity header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));

    const stored = await seedMemories(params);

    expect(stored).toBe(SEED_MEMORIES.length);
    expect(fetchMock).toHaveBeenCalledTimes(SEED_MEMORIES.length);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The trailing slash on `apiUrl` is stripped rather than doubled.
    expect(url).toBe("http://localhost:7250/api/memories");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer cpk_test",
      "X-Cpki-User-Id": params.userId,
    });
    expect(JSON.parse(String(init.body))).toEqual(SEED_MEMORIES[0]);
  });

  it("counts a rejection instead of throwing, so the store reset still reports", async () => {
    // A presenter needs the trip record restored far more urgently than they need
    // a stack trace, and the route classifies the shortfall from this count.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValue(new Response("nope", { status: 401 }));

    await expect(seedMemories(params)).resolves.toBe(1);
  });

  it("counts a transport failure the same way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(seedMemories(params)).resolves.toBe(0);
  });
});
