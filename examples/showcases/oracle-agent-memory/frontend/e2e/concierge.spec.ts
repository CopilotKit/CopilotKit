import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  openChat,
  newThread,
  sendMessage,
  sendAndAwaitRun,
  askUntilReply,
  assertNoAgentError,
} from "./helpers";

// Unique to *this* test run: a distinctive PROGRAM (the key — it appears in both
// the teaching message and the question) and FF_NUMBER (the answer — only in the
// teaching message and the recalled reply). The unique key lets semantic recall
// pin exactly this run's memory even though `demo-user` accumulates facts across
// runs and across both cookbook projects (which share the user).
const RUN = `${Date.now()}`;
const PROGRAM = `FlyHigh-${RUN}`;
const FF_NUMBER = `ZEPHYR-${RUN}`;

test.describe("Travel Concierge · Oracle Agent Spec × Memory", () => {
  // Runs first, against the freshly-reset store (global-setup.ts). The concierge
  // recalls through a *model-driven* `recall_memory` tool, and every turn —
  // including a failed recall — is persisted; so a retry would persist an "I
  // don't have it" reply that poisons the next attempt. We therefore do ONE
  // clean recall, after ensuring the taught fact is committed.
  test("recalls a preference in a brand-new session (cross-session memory)", async ({
    page,
  }) => {
    // ── Session A — store a unique fact. The concierge persists the turn in a
    // background task after the stream closes, then Oracle Agent Memory extracts
    // + embeds + indexes it asynchronously, so the fact is not instantly
    // recallable (we poll for it below before recalling).
    await openChat(page);
    await sendAndAwaitRun(
      page,
      `Please remember that my ${PROGRAM} frequent flyer number is ${FF_NUMBER}.`,
    );
    await assertNoAgentError(page);

    // Block until the fact is actually searchable in Oracle (polling the same
    // memory.search path recall_memory uses) before starting a fresh thread — a
    // fixed sleep races the async indexing pipeline and makes recall flaky.
    const agentDir = path.join(__dirname, "..", "..", "agent");
    const waitScript = path.join(__dirname, "wait-until-searchable.py");
    try {
      execFileSync(
        "uv",
        ["run", "--directory", agentDir, "python", waitScript, FF_NUMBER],
        { encoding: "utf8", stdio: "pipe", timeout: 150_000 },
      );
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message: string };
      throw new Error(
        `Taught fact never became searchable in Oracle: ${e.stderr || e.stdout || e.message}`,
        { cause: err },
      );
    }

    // ── Recall — open a new thread via the sidebar. A new thread remounts
    // CopilotChat with a fresh threadId, so the only source for the number is
    // user-scoped Oracle memory recalled by recall_memory. One attempt, no
    // retry (see comment at top of describe block).
    await newThread(page);
    await askUntilReply(
      page,
      `What is my ${PROGRAM} frequent flyer number? Use what you remember about me.`,
      [new RegExp(FF_NUMBER, "i")],
      { attempts: 1, perAttemptMs: 120_000 },
    );
    await assertNoAgentError(page);
  });

  test("finds a flight in a single turn (recall_memory + search_flights)", async ({
    page,
  }) => {
    await openChat(page);
    // Exercises the server tools: recalls preferences, then searches flights.
    // Assert on details from the canonical Amsterdam flight (AMS-001: KLM KL606,
    // SFO → AMS, nonstop, $740) — these come from the assistant's reply, not
    // the user's question (which only says "Amsterdam"), so this proves the
    // search_flights tool actually ran and the model presented its result.
    // One attempt, no retry: a retry would be a *second* turn after this turn's
    // server tools ran, which trips the upstream multi-turn tool_call_id bug and
    // can never succeed — so retrying only guarantees failure.
    await askUntilReply(
      page,
      "Find me a flight to Amsterdam.",
      [/740|KLM|AMS-001|nonstop/i],
      { attempts: 1, perAttemptMs: 120_000 },
    );
    await assertNoAgentError(page);
  });

  // HITL booking — works as a single run because `book_flight` is a frontend
  // ClientTool: the confirmation card is rendered by the UI and resolved within
  // the same agent run (no second user turn, so the upstream Agent Spec × AG-UI
  // adapter bug with tool_call_id correlation is never triggered). Previously
  // tracked in:
  //   docs/known-issues/agentspec-multiturn-toolcall-correlation.md
  test("confirms before booking (HITL, single-run ClientTool)", async ({
    page,
  }) => {
    await openChat(page);
    // A fresh thread is not strictly required here (this is the first interaction
    // in the test), but newThread() would also work if isolation is needed later.
    // One attempt, no retry: the booking ask runs recall_memory (a server tool)
    // in this turn, so a retry would be a second turn and trip the upstream
    // multi-turn bug. Give the single attempt a generous window instead.
    await askUntilReply(
      page,
      "Book me flight AMS-001 to Amsterdam.",
      [/confirm your booking|confirm & book/i],
      { attempts: 1, perAttemptMs: 120_000 },
    );
    // Click the generative-UI confirmation card button surfaced by the ClientTool.
    await page.getByRole("button", { name: /confirm & book/i }).click();
    // Assert the boarding-pass badge ("CONFIRMED ✓"), not the echoed respond-payload
    // string ("CONFIRMED — booked …"). The ✓ glyph appears only in the badge, so
    // this fails before the run resolves instead of passing off the echoed payload.
    await expect(page.getByText(/CONFIRMED ✓/)).toBeVisible({
      timeout: 60_000,
    });
    await assertNoAgentError(page);
  });

  // The card-click booking path — distinct from the conversational HITL path
  // above. Selecting a flight drives confirm → book entirely client-side in
  // FlightOptions (no agent turn), so the confirm card renders inline in view
  // and nothing is appended to the chat. Regression guard for the "select does
  // nothing / confirm card scrolled off-screen" bug: the old path injected a
  // "Book me flight …" user message and ran the agent; here we assert NO such
  // message is ever appended.
  test("books inline from the flight card (client-side select → confirm → book)", async ({
    page,
  }) => {
    await openChat(page);
    // Render the flight cards (search_flights genUI). One attempt, no retry: this
    // turn runs server tools, so a retry would trip the upstream multi-turn bug.
    await sendMessage(page, "Find me a flight to Amsterdam.");
    const selectBtn = () =>
      page.getByRole("button", { name: /select this flight/i }).first();
    await expect(selectBtn()).toBeVisible({ timeout: 120_000 });

    // Select → inline confirm card, with no agent round-trip (no injected message).
    await selectBtn().click();
    await expect(page.getByText(/confirm your booking/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/book me flight/i)).toHaveCount(0);

    // Cancel → back to the flight list.
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(selectBtn()).toBeVisible({ timeout: 15_000 });

    // Select again → confirm & book → boarding pass, still no agent turn.
    await selectBtn().click();
    await expect(page.getByText(/confirm your booking/i)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /confirm & book/i }).click();
    await expect(page.getByText(/CONFIRMED ✓/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/book me flight/i)).toHaveCount(0);
    await assertNoAgentError(page);
  });
});
