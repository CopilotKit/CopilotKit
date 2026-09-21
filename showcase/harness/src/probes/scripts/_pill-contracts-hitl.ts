import type { Page as PlaywrightPage } from "playwright";
import { attachSseInterceptor } from "../helpers/sse-interceptor.js";
import {
  readErrorBanner,
  runConversation,
} from "../helpers/conversation-runner.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

export type HitlFeature =
  | "hitl-approve-deny"
  | "hitl-text-input"
  | "gen-ui-interrupt"
  | "interrupt-headless";
export const HITL_ROUTES: Record<HitlFeature, string> = {
  "hitl-approve-deny": "/demos/hitl-in-app",
  "hitl-text-input": "/demos/hitl-in-chat",
  "gen-ui-interrupt": "/demos/gen-ui-interrupt",
  "interrupt-headless": "/demos/interrupt-headless",
};
export const APPROVAL_PILLS = [
  {
    tag: "refund",
    buttonName: "Approve refund for #12345",
    prompt:
      "Please approve a $50 refund to Jordan Rivera on ticket #12345 for the duplicate charge.",
    values: ["$50", "Jordan Rivera", "#12345"],
    verb: "refund",
  },
  {
    tag: "downgrade",
    buttonName: "Downgrade plan for #12346",
    prompt:
      "Please downgrade Priya Shah (#12346) to the Starter plan effective next billing cycle.",
    values: ["Priya Shah", "#12346", "Starter", "next billing cycle"],
    verb: "downgrade",
  },
  {
    tag: "escalate",
    buttonName: "Escalate ticket #12347",
    prompt:
      "Please escalate ticket #12347 to the payments team — Morgan Lee's payment is stuck.",
    values: ["#12347", "payments team", "Morgan Lee"],
    verb: "escalat",
  },
] as const;
export const BOOKING_PILLS = [
  {
    tag: "sales-call",
    buttonName: "Book a call with sales",
    prompt: "Book an intro call with the sales team to discuss pricing.",
    topic: "Sales intro call",
    attendee: "Sales team",
  },
  {
    tag: "alice-1on1",
    buttonName: "Schedule a 1:1 with Alice",
    prompt: "Schedule a 1:1 with Alice next week to review Q2 goals.",
    topic: "1:1 with Alice",
    attendee: "Alice",
  },
] as const;
export const SLOT_LABELS = [
  "Tomorrow 10:00 AM",
  "Tomorrow 2:00 PM",
  "Monday 9:00 AM",
  "Monday 3:30 PM",
] as const;

// Browser code is a plain function body so tsx cannot inject a Node-only helper.
async function visibleTexts(page: Page, selector: string): Promise<string[]> {
  const read = new Function(
    `const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]; return nodes.filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').map(n => n.innerText ?? n.textContent ?? '');`,
  ) as () => string[];
  return page.evaluate(read);
}
async function rejectVisibleErrors(page: Page): Promise<void> {
  const banner = await readErrorBanner(page);
  if (banner.state === "visible")
    throw new Error(`HITL application error: ${banner.text}`);
  if (banner.state === "unreadable")
    throw new Error(
      `HITL application error state unreadable: ${banner.detail}`,
    );
  const marked = await visibleTexts(page, '[data-testid="copilot-error"]');
  const alerts = await visibleTexts(page, '[role="alert"]');
  if (marked.length || alerts.some((text) => /error|failed/i.test(text)))
    throw new Error(
      `HITL application error: ${[...marked, ...alerts].join(" ")}`,
    );
}
async function waitText(
  page: Page,
  selector: string,
  check: (text: string) => void | Promise<void>,
  timeout = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let last = "no visible result";
  while (Date.now() < deadline) {
    await rejectVisibleErrors(page);
    const texts = await visibleTexts(page, selector);
    let matched = false;
    try {
      if (!texts.length) throw new Error("no visible result");
      await check(texts[texts.length - 1]!);
      matched = true;
    } catch (error) {
      last = String(error);
    }
    if (matched) {
      // The resumed run may paint an error while its result is being read.
      await rejectVisibleErrors(page);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`HITL result failed: ${last}`);
}
function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function requireValues(text: string, values: readonly string[]): void {
  for (const value of values) {
    const exact = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapePattern(value)}(?![\\p{L}\\p{N}_]|[-'’][\\p{L}\\p{N}])`,
      "u",
    );
    if (!exact.test(text))
      throw new Error(
        `missing visible value ${JSON.stringify(value)} in ${JSON.stringify(text)}`,
      );
  }
}
type ApprovalPill = (typeof APPROVAL_PILLS)[number];
const APPROVAL_ACTIONS: Record<ApprovalPill["verb"], RegExp> = {
  refund: /\$50(?:\.00)? refund to Jordan Rivera on ticket #12345(?![\w.-]\w)/,
  downgrade:
    /\b(?:downgrad(?:e|ed|ing) Priya Shah \(#12346\) to (?:the )?Starter plan effective next billing cycle|Downgrade confirmed [—–-] Priya Shah \(#12346\) will move to the Starter plan effective next billing cycle)\b/i,
  escalat:
    /\bescalat(?:e|ed|ing) ticket #12347 to the payments team for Morgan Lee\b/i,
};
export function assertApprovalResult(
  text: string,
  pill: ApprovalPill,
  decision: "approve" | "deny",
): void {
  requireValues(text, pill.values);
  const tickets = text.match(/#[\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*/gu) ?? [];
  const expectedTicket = pill.values.find((value) => value.startsWith("#"));
  const amounts = text.match(/\$\d[\d,]*(?:\.\d+)?/g) ?? [];
  const expectedAmount = pill.values.find((value) => value.startsWith("$"));
  if (
    tickets.some((ticket) => ticket !== expectedTicket) ||
    amounts.some(
      (amount) =>
        amount !== expectedAmount && amount !== `${expectedAmount}.00`,
    )
  )
    throw new Error(`wrong approval amount or ticket: ${text}`);
  // Bind the amount/action/recipient/ticket or plan/team relationship, not
  // merely the presence of those words somewhere in the continuation.
  if (!APPROVAL_ACTIONS[pill.verb].test(text))
    throw new Error(`wrong ${pill.verb} action relationship: ${text}`);
  const denied =
    /not approved|not escalated|not downgraded|reject|denied|declined|cancelled/i.test(
      text,
    );
  const approved = /processing|confirmed|will move|^Escalated|^Approved/i.test(
    text,
  );
  if (decision === "approve" ? !approved || denied : !denied || approved)
    throw new Error(`ambiguous or wrong ${decision} continuation: ${text}`);
}
async function clickExact(page: Page, name: string): Promise<void> {
  if (!page.getByRole) throw new Error("HITL requires actual button controls");
  const button = page.getByRole("button", { name, exact: true });
  if (
    (await button.count()) !== 1 ||
    !(await button.isVisible()) ||
    !(await button.isEnabled())
  )
    throw new Error(
      `missing, duplicate, hidden or disabled HITL button ${name}`,
    );
  await button.click();
}
const ASSISTANT = '[data-testid="copilot-assistant-message"]';
async function latestAssistantCount(page: Page): Promise<number> {
  return (await visibleTexts(page, ASSISTANT)).length;
}
async function finishedRuns(page: Page): Promise<number> {
  return page.evaluate(
    new Function("return globalThis.__hk_runsFinished ?? 0") as () => number,
  );
}
async function newAssistant(
  page: Page,
  baseline: number,
  baselineFinished: number,
  check: (text: string) => void,
): Promise<void> {
  await waitText(page, ASSISTANT, async (text) => {
    if ((await latestAssistantCount(page)) <= baseline)
      throw new Error(
        "HITL continuation did not create a new assistant message",
      );
    if ((await finishedRuns(page)) <= baselineFinished)
      throw new Error("HITL resumed run has not finished");
    check(text);
  });
}
async function inventory(page: Page, feature: HitlFeature): Promise<void> {
  const expected =
    feature === "hitl-approve-deny"
      ? APPROVAL_PILLS.map((p) => p.buttonName)
      : BOOKING_PILLS.map((p) => p.buttonName);
  const actual = (
    await visibleTexts(page, '[data-testid="copilot-suggestion"]')
  ).map((text) => text.trim());
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `HITL pill inventory differs from LGP: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}
export function buildHitlTurns(feature: HitlFeature): ConversationTurn[] {
  if (feature === "hitl-approve-deny")
    return APPROVAL_PILLS.flatMap((pill) =>
      (["approve", "deny"] as const).map((decision) => ({
        input: pill.prompt,
        action: {
          kind: "pill" as const,
          id: `${feature}:${pill.tag}:${decision}`,
          buttonName: pill.buttonName,
          expectedDispatchedPrompt: pill.prompt,
          submission: { kind: "immediate" as const },
        },
        preFill: (page: Page) => inventory(page, feature),
        completeOnMount: { testIds: ["approval-dialog-overlay"] },
        responseTimeoutMs: 60_000,
        assertions: async (page: Page) => {
          await waitText(page, '[data-testid="approval-dialog"]', (text) =>
            requireValues(text, pill.values),
          );
          const baseline = await latestAssistantCount(page);
          const baselineFinished = await finishedRuns(page);
          await clickExact(page, decision === "approve" ? "Approve" : "Reject");
          await newAssistant(page, baseline, baselineFinished, (text) =>
            assertApprovalResult(text, pill, decision),
          );
          if (
            (
              await visibleTexts(
                page,
                '[data-testid="approval-dialog-overlay"]',
              )
            ).length
          )
            throw new Error("approval dialog stayed visible after decision");
          await rejectVisibleErrors(page);
        },
      })),
    );
  return BOOKING_PILLS.map((pill) => {
    const prompt =
      feature === "hitl-text-input" && pill.tag === "sales-call"
        ? `Please ${pill.prompt[0]!.toLowerCase()}${pill.prompt.slice(1)}`
        : pill.prompt;
    const headless = feature === "interrupt-headless";
    const card = headless ? "interrupt-headless-popup" : "time-picker-card";
    return {
      input: prompt,
      action: {
        kind: "pill" as const,
        id: `${feature}:${pill.tag}`,
        buttonName: pill.buttonName,
        expectedDispatchedPrompt: prompt,
        submission: { kind: "immediate" as const },
      },
      preFill: (page: Page) => inventory(page, feature),
      completeOnMount: { testIds: [card] },
      responseTimeoutMs: 60_000,
      assertions: async (page: Page) => {
        await waitText(page, `[data-testid="${card}"]`, (text) =>
          requireValues(text, [pill.topic, pill.attendee, ...SLOT_LABELS]),
        );
        const baseline = await latestAssistantCount(page);
        const baselineFinished = await finishedRuns(page);
        await clickExact(page, SLOT_LABELS[0]);
        if (!headless)
          await waitText(page, '[data-testid="time-picker-picked"]', (text) =>
            requireValues(text, [
              feature === "hitl-text-input" ? "Booked for" : "Booked",
              SLOT_LABELS[0],
            ]),
          );
        await newAssistant(page, baseline, baselineFinished, (text) => {
          requireValues(text, [pill.topic]);
          if (
            !/booked|scheduled|confirmed/i.test(text) ||
            /not booked|not scheduled|cancelled|denied/i.test(text)
          )
            throw new Error(`wrong booking result: ${text}`);
        });
        if (headless) {
          if (
            (
              await visibleTexts(
                page,
                '[data-testid="interrupt-headless-popup"]',
              )
            ).length
          )
            throw new Error("headless picker stayed visible after booking");
          await waitText(
            page,
            '[data-testid="interrupt-headless-empty"]',
            (text) => requireValues(text, ["Nothing scheduled yet"]),
          );
        } else if (feature === "hitl-text-input") {
          await waitText(page, '[data-testid="time-picker-picked"]', (text) =>
            requireValues(text, [
              feature === "hitl-text-input" ? "Booked for" : "Booked",
              SLOT_LABELS[0],
            ]),
          );
        }
        await rejectVisibleErrors(page);
      },
    };
  });
}

/** Local specs use precisely the same actions and assertions as the matrix. */
export async function runHitlCanonical(
  page: PlaywrightPage,
  feature: HitlFeature,
): Promise<void> {
  const capture = await attachSseInterceptor(page);
  try {
    const result = await runConversation(page, buildHitlTurns(feature), {
      mode: "functional-pill",
    });
    if (!result.pillExecution?.completed)
      throw new Error(
        result.error ?? "canonical HITL actions did not all complete",
      );
  } finally {
    await capture.stop();
  }
}
