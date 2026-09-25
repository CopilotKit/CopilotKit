import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import commerce from "@/skins/commerce/skin";
import { RESTOCK_PLAN_MESSAGE } from "@/skins/commerce/suggestions";
// The composer selectors are NOT on the `@/shell/attach` barrel — it exports the
// three entry points and their types, deliberately, because no skin CALL SITE
// needs a selector. A test driving the real DOM does, so it reaches one level in.
import {
  ATTACHMENT_CHIP_SELECTOR,
  ATTACHMENT_QUEUE_SELECTOR,
  CHAT_TEXTAREA_SELECTOR,
} from "@/shell/attach/stage-attachment";
import {
  attachPriceSheetByHand,
  sendRestockRequestWithPriceSheet,
} from "@/skins/commerce/attach-price-sheet";

/**
 * What is left to test in commerce once the chain is shell-owned.
 *
 * The fifteen detection causes, the bounded condition waits, the abort rule and
 * the dual reporting are verified ONCE, in
 * `src/shell/attach/stage-attachment.test.ts`. Re-driving them here would assert
 * the same module three times over — the duplication this extraction removed.
 *
 * Three things remain genuinely commerce's, and all three are silent when wrong:
 *
 *   1. **The three parameters.** `attach-price-sheet.ts` is now nothing BUT a
 *      URL, a filename and a message. A wrong URL 404s and the pill aborts (loud,
 *      recoverable); a wrong MESSAGE is the dangerous one — the pill still sends,
 *      just not the prompt the beat needs. So these are asserted against
 *      hardcoded literals, never against the module's own constants: a test that
 *      imports the value it checks cannot notice the value changing.
 *   2. **`onSuggestionSelect` claims the right pill.** Returning `true` means the
 *      shell will NOT run its default send, so a mismatch here is a dead pill.
 *   3. **`true` is never returned into silence.** The historical bug: the handler
 *      claimed the click and then did nothing observable at all.
 *
 * Driven against the real chain and a fake composer rather than a mocked
 * `@/shell/attach`, because a mock would prove commerce passes three values to a
 * function and nothing about whether those values work. The fixture below
 * reproduces the framework's observable ATTACHMENT STATE MACHINE, trimmed to the
 * states these assertions need (the per-cause knobs moved to the shell's fixture
 * along with the causes they drive).
 */

/**
 * jsdom implements no drag-and-drop, so it ships no `DataTransfer` — and that is
 * the only way to build a `FileList`, which is what `input.files` demands. The
 * stub is the narrowest possible: an `items.add` that collects Files and a
 * `files` view shaped like a FileList. Without it the happy path throws inside
 * the production try/catch and reports a failure, which would make the
 * fail-loud assertions below pass for entirely the wrong reason.
 */
class DataTransferStub {
  private collected: File[] = [];
  items = {
    add: (file: File) => {
      this.collected.push(file);
    },
  };
  get files(): FileList {
    const list = this.collected;
    return Object.assign([...list], {
      item: (i: number) => list[i] ?? null,
      length: list.length,
    }) as unknown as FileList;
  }
}

beforeEach(() => {
  vi.stubGlobal("DataTransfer", DataTransferStub);
});

/**
 * No `Beat3dTimings` are injected here, on purpose. The shell chain accepts them
 * so its own tests can force a budget to EXPIRE deterministically — and a skin's
 * thin wrapper exposes no such parameter, because a skin has no reason to retune
 * the framework's encode. Nothing below waits out a budget: the happy paths
 * satisfy each condition within a poll or two, and the failure paths fail on the
 * fetch, before the first wait. The whole file runs in well under a second.
 */

// ── the composer, as CopilotChat actually behaves ───────────────────────────

interface ComposerOptions {
  textarea?: boolean;
  sendButton?: boolean;
  /**
   * How long base64 encoding takes before the chip flips `uploading` → `ready`
   * and the queue starts printing the filename. A chip in the queue is not yet a
   * sendable attachment (use-attachments.tsx:103-144, 245-253).
   */
  encodeMs?: number;
}

const sendClicks = vi.fn();

function mountComposer({
  textarea = true,
  sendButton = true,
  encodeMs = 0,
}: ComposerOptions = {}) {
  document.body.innerHTML = "";

  // The queue is mounted ONLY while non-empty (CopilotChatView.tsx:356), so it
  // starts absent and is created on the first accepted file.
  const ensureQueue = () => {
    let queue = document.querySelector<HTMLElement>(ATTACHMENT_QUEUE_SELECTOR);
    if (!queue) {
      queue = document.createElement("div");
      queue.setAttribute("data-testid", "copilot-attachment-queue");
      document.body.appendChild(queue);
    }
    return queue;
  };
  const dropQueueIfEmpty = () => {
    const queue = document.querySelector<HTMLElement>(
      ATTACHMENT_QUEUE_SELECTOR,
    );
    if (
      queue &&
      queue.querySelectorAll(ATTACHMENT_CHIP_SELECTOR).length === 0
    ) {
      queue.remove();
    }
  };

  const input = document.createElement("input");
  input.type = "file";
  input.setAttribute("accept", "application/pdf,image/*");
  // jsdom's `files` setter runs a webidl conversion that only accepts a real
  // jsdom FileList wrapper, which no stub can produce — it rejects even a
  // correctly shaped object with a TypeError. Replace the accessor with a plain
  // data property so the production `input.files = dt.files` is an ordinary
  // write. (Verified the hard way: without this the assignment throws, the
  // production catch turns it into a reported failure, and every fail-loud
  // assertion in this file would pass for the wrong reason.)
  Object.defineProperty(input, "files", {
    writable: true,
    configurable: true,
    value: null,
  });
  input.addEventListener("change", () => {
    const picked = input.files?.[0];
    if (!picked) return;

    // A chip appears on the next tick, as a React re-render would.
    setTimeout(() => {
      const chip = document.createElement("div");
      // The chip renders an EMPTY body while uploading
      // (CopilotChatAttachmentQueue.tsx:43,75-77) — no filename yet.
      const remove = document.createElement("button");
      remove.setAttribute("aria-label", "Remove attachment");
      chip.appendChild(remove);
      chip.dataset.ready = "false";
      ensureQueue().appendChild(chip);

      setTimeout(() => {
        // `ready`: DocumentPreview prints the filename
        // (CopilotChatAttachmentQueue.tsx:357-359).
        const name = document.createElement("span");
        name.textContent = picked.name;
        chip.insertBefore(name, remove);
        chip.dataset.ready = "true";
      }, encodeMs);
    }, 0);
  });
  document.body.appendChild(input);

  let btn: HTMLButtonElement | undefined;
  if (sendButton) {
    btn = document.createElement("button");
    btn.setAttribute("data-testid", "copilot-send-button");
    const mark = document.createElement("span");
    // lucide-react stamps `lucide-<kebab-name>`; the production code reads that
    // mark to tell SEND from STOP (CopilotChatInput.tsx:540-547, 1158).
    mark.className = "lucide-arrow-up";
    btn.appendChild(mark);
    // disabled = isProcessing ? !canStop : !canSend.
    btn.disabled = true;
    btn.addEventListener("click", () => {
      sendClicks();
      if (btn?.disabled) return; // a real disabled button dispatches nothing
      // consumeAttachments(): every READY chip leaves the queue
      // (use-attachments.tsx:245-253), as part of building the message.
      document
        .querySelectorAll<HTMLElement>(
          `${ATTACHMENT_QUEUE_SELECTOR} [data-ready="true"]`,
        )
        .forEach((chip) => chip.remove());
      dropQueueIfEmpty();
    });
    document.body.appendChild(btn);
  }

  if (textarea) {
    const el = document.createElement("textarea");
    el.setAttribute("data-testid", "copilot-chat-textarea");
    el.addEventListener("input", () => {
      if (!btn) return;
      // canSend = value.trim().length > 0 (CopilotChatInput.tsx:517)
      btn.disabled = el.value.trim().length === 0;
    });
    document.body.appendChild(el);
  }
}

function queuedChipCount() {
  return document.querySelectorAll(
    `${ATTACHMENT_QUEUE_SELECTOR} ${ATTACHMENT_CHIP_SELECTOR}`,
  ).length;
}

/** A real PDF body — checked on the BYTES by the shell chain. */
const pdfBytes = () => new TextEncoder().encode("%PDF-1.4\nprice sheet\n%%EOF");

/**
 * A 200 carrying `body`. Both `arrayBuffer()` and `blob()` are provided because a
 * real `Response` has both: a stub missing one would make a failure look like
 * "the route is broken" when it is really "the test lied about the Response
 * shape", and that contaminates exactly the failure messages this file asserts on.
 */
const okResponse = () =>
  ({
    ok: true,
    status: 200,
    arrayBuffer: async () => pdfBytes().slice().buffer,
    blob: async () => new Blob([pdfBytes().slice()]),
  }) as unknown as Response;

// The two halves of "say something": the log line, and the thing a presenter on
// stage will actually notice.
let errorSpy: MockInstance;
let alertSpy: MockInstance;

beforeEach(() => {
  sendClicks.mockClear();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Everything the presenter would see: the log line plus the on-stage alert. */
function surfacedText() {
  const calls = [...errorSpy.mock.calls, ...alertSpy.mock.calls];
  return calls.map((args) => args.map(String).join(" ")).join("\n");
}

// The three values that are commerce's, written out rather than imported: a test
// that imports the constant it checks cannot notice the constant changing.
const EXPECTED_URL = "/api/commerce/v1/price-sheet";
const EXPECTED_FILENAME = "price-sheet-kestrel-mills.pdf";

describe("sendRestockRequestWithPriceSheet", () => {
  it("fetches the price-sheet route, attaches it under its own filename, and sends the restock prompt", async () => {
    mountComposer({ encodeMs: 10 });
    const fetchSpy = vi.fn(okResponse);
    vi.stubGlobal("fetch", fetchSpy);

    const sent = await sendRestockRequestWithPriceSheet();

    expect(sent).toBe(true);
    // 1 — the URL commerce passes.
    expect(fetchSpy).toHaveBeenCalledWith(EXPECTED_URL);
    // 2 — the filename, read off the File the composer was actually handed. It
    // cannot be read off the chip here: a confirmed send has CONSUMED the chip
    // by this point, which is the third assertion below. The paperclip case,
    // which never sends, is where the chip is checked for printing it.
    expect(
      document.querySelector<HTMLInputElement>(
        'input[type="file"][accept*="pdf"]',
      )?.files?.[0]?.name,
    ).toBe(EXPECTED_FILENAME);
    // 3 — the message, which is the parameter that fails SILENTLY when wrong:
    // the pill still sends, just not the prompt the beat needs.
    expect(
      document.querySelector<HTMLTextAreaElement>(CHAT_TEXTAREA_SELECTOR)
        ?.value,
    ).toBe(RESTOCK_PLAN_MESSAGE);
    expect(sendClicks).toHaveBeenCalledTimes(1);
    // Consumed: the attachment rode the message out.
    expect(queuedChipCount()).toBe(0);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("aborts the send, loudly, when the price-sheet route fails", async () => {
    // One representative failure, not the taxonomy — the fifteen causes are
    // driven in src/shell/attach/stage-attachment.test.ts. What is asserted here
    // is that commerce is wired to a chain that ABORTS: without the sheet the
    // model invents the costs and the plan is filed anyway.
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );

    const sent = await sendRestockRequestWithPriceSheet();

    expect(sent).toBe(false);
    expect(sendClicks).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLTextAreaElement>(CHAT_TEXTAREA_SELECTOR)
        ?.value,
    ).toBe("");
    expect(errorSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
    expect(surfacedText()).toContain(EXPECTED_URL);
  });
});

describe("attachPriceSheetByHand: the paperclip fallback", () => {
  it("attaches the sheet and sends nothing", async () => {
    mountComposer({ encodeMs: 10 });
    const fetchSpy = vi.fn(okResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(attachPriceSheetByHand()).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith(EXPECTED_URL);
    // The chip PRINTS the filename — which is the signal the chain waits on to
    // know base64 encoding finished, and the one thing a presenter can see.
    expect(
      document.querySelector(ATTACHMENT_QUEUE_SELECTOR)?.textContent,
    ).toContain(EXPECTED_FILENAME);
    expect(sendClicks).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("reports rather than resolving quietly when staging fails", async () => {
    // It is the fallback for a misbehaving pill, so it must be the loudest link:
    // if this one fails quietly too, the presenter has nothing left to try.
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );

    await expect(attachPriceSheetByHand()).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
    // It never intended to send, so it must not claim a send failed.
    expect(surfacedText()).not.toContain("nothing was sent");
  });
});

describe("commerce.onSuggestionSelect", () => {
  const pill = {
    title: "File the restock plan",
    message: RESTOCK_PLAN_MESSAGE,
  };

  it("passes every other pill through to the shell's default send", () => {
    mountComposer();
    expect(
      commerce.onSuggestionSelect?.(
        { title: "Show me the margin ladder", message: "Show me the ladder." },
        0,
      ),
    ).toBe(false);
  });

  it("claims the restock pill, and never claims it silently", () => {
    // Semantics: `true` means "the shell must NOT run its default send", which
    // is unconditionally right here — the default path drops attachments. What
    // must never happen again is `true` plus total silence, so a missing
    // composer has to have surfaced something by the time this returns. The
    // report is synchronous (the shell chain locates the composer before the
    // first await), which is exactly why that lookup comes ahead of staging.
    mountComposer({ textarea: false, sendButton: false });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    expect(commerce.onSuggestionSelect?.(pill, 4)).toBe(true);

    expect(alertSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
