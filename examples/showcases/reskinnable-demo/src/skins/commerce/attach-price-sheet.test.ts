import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import commerce from "@/skins/commerce/skin";
import { RESTOCK_PLAN_MESSAGE } from "@/skins/commerce/suggestions";
import type { Beat3dTimings } from "@/skins/commerce/attach-price-sheet";
import {
  ATTACHMENT_CHIP_SELECTOR,
  ATTACHMENT_QUEUE_SELECTOR,
  CHAT_TEXTAREA_SELECTOR,
  PRICE_SHEET_FILENAME,
  PRICE_SHEET_FILE_INPUT_SELECTOR,
  PRICE_SHEET_URL,
  attachPriceSheetByHand,
  sendRestockRequestWithPriceSheet,
  stagePriceSheetAttachment,
} from "@/skins/commerce/attach-price-sheet";

/**
 * BEAT 3d's failure contract.
 *
 * The beat claims a REAL vendor price sheet was ingested into a durable restock
 * plan. The catastrophic failure is not "the beat did not run" — it is "the
 * prompt was sent with NO attachment", because the model then invents a cost
 * sheet, the plan is still filed, and the artifact reads plausibly. The demo
 * looks perfect while proving the opposite of its point.
 *
 * The defect CLASS these tests exist to make unrepresentable is broader than any
 * one bug: **an async DOM-driving step that resolves `true` without confirming
 * its effect.** Fetching, staging, encoding and clicking are all REQUESTS made of
 * code we do not own; each one has to be observed. So the file asserts:
 *
 *   1. the prompt is not sent unless the sheet is queued AND finished encoding —
 *      for every way each of those can fail;
 *   2. the send is not claimed unless the click actually consumed the attachment;
 *   3. every failure surfaces something a presenter can see (`console.error` for
 *      the log AND `window.alert` for the stage) and names ITSELF, because "retry
 *      the pill", "press send by hand" and "restart the dev server" are different
 *      instructions;
 *   4. a missing composer does not leave `onSuggestionSelect` having returned
 *      `true` — "handled" — with nothing whatsoever having happened.
 *
 * Written against the DOM rather than a render because the whole mechanism IS
 * DOM manipulation: it reaches for framework-owned elements by test id. What the
 * fake composer below reproduces is not React, it is the framework's observable
 * ATTACHMENT STATE MACHINE, which is the thing being verified.
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
 * Fast budgets. Production waits seconds because a real encode can take them;
 * a test that spent the real budget on each expiry branch would add half a
 * minute to the suite. `0` forces the expiry branch deterministically —
 * `waitUntil` still evaluates its predicate, so a condition that is already true
 * still passes with a `0` budget.
 */
const FAST: Beat3dTimings = {
  acceptMs: 200,
  readyMs: 200,
  sendableMs: 200,
  consumedMs: 200,
  pollMs: 5,
};
const fast = (over: Partial<Beat3dTimings> = {}): Beat3dTimings => ({
  ...FAST,
  ...over,
});

// ── the composer, as CopilotChat actually behaves ───────────────────────────

interface ComposerOptions {
  fileInput?: boolean;
  textarea?: boolean;
  sendButton?: boolean;
  /**
   * `processFiles` drops a file that fails `accept`/`maxSize` and calls an
   * `onUploadFailed` this app does not wire — so a rejection means NO chip ever
   * appears (use-attachments.tsx:76-99). That silence is the whole point.
   */
  rejectFile?: boolean;
  /**
   * How long base64 encoding takes before the chip flips `uploading` → `ready`
   * and the queue starts printing the filename. `"never"` is a stuck encode:
   * `consumeAttachments` would hand over nothing and `onSubmitInput` would refuse
   * to send at all.
   */
  encodeMs?: number | "never";
  /**
   * Which role the ONE send/stop button is playing. `"stop"` mirrors a run in
   * flight: enabled, carrying the square mark, and a click cancels the run.
   * `"unrecognized"` mirrors a lucide rename.
   */
  sendRole?: "send" | "stop" | "unrecognized";
  /** Simulates React never registering the typed prompt: `canSend` stays false. */
  neverEnableSend?: boolean;
  /**
   * Whether the click runs `consumeAttachments` — the only thing that removes a
   * ready chip, and only as part of dispatching the message.
   */
  consumeOnSend?: boolean;
}

const sendClicks = vi.fn();

function mountComposer({
  fileInput = true,
  textarea = true,
  sendButton = true,
  rejectFile = false,
  encodeMs = 0,
  sendRole = "send",
  neverEnableSend = false,
  consumeOnSend = true,
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

  if (fileInput) {
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
      if (!picked || rejectFile) return; // dropped, silently, exactly as the framework does

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

        if (encodeMs === "never") return;
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
  }

  let btn: HTMLButtonElement | undefined;
  if (sendButton) {
    btn = document.createElement("button");
    btn.setAttribute("data-testid", "copilot-send-button");
    const mark = document.createElement("span");
    // lucide-react stamps `lucide-<kebab-name>`; the production code reads that
    // mark to tell SEND from STOP (CopilotChatInput.tsx:540-547, 1158).
    if (sendRole === "stop") mark.className = "lucide-square";
    else if (sendRole === "send") mark.className = "lucide-arrow-up";
    btn.appendChild(mark);
    // disabled = isProcessing ? !canStop : !canSend. A stop button is ENABLED.
    btn.disabled = sendRole !== "stop";
    btn.addEventListener("click", () => {
      sendClicks();
      if (btn?.disabled) return; // a real disabled button dispatches nothing
      if (sendRole === "stop") return; // a click here cancels the run; nothing is sent
      if (!consumeOnSend) return;
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
      if (!btn || sendRole === "stop") return; // isProcessing: canSend is irrelevant
      // canSend = value.trim().length > 0 (CopilotChatInput.tsx:517)
      btn.disabled = neverEnableSend || el.value.trim().length === 0;
    });
    document.body.appendChild(el);
  }
}

function queuedChipCount() {
  return document.querySelectorAll(
    `${ATTACHMENT_QUEUE_SELECTOR} ${ATTACHMENT_CHIP_SELECTOR}`,
  ).length;
}

/** A real PDF body — checked on the BYTES by the production code. */
const pdfBytes = () => new TextEncoder().encode("%PDF-1.4\nprice sheet\n%%EOF");

/**
 * A 200 carrying `body`. Both `arrayBuffer()` and `blob()` are provided because a
 * real `Response` has both: a stub missing one would make a failure look like
 * "the route is broken" when it is really "the test lied about the Response
 * shape", and that contaminates exactly the failure messages this file asserts on.
 */
const bodyResponse = (body: Uint8Array) =>
  ({
    ok: true,
    status: 200,
    arrayBuffer: async () => body.slice().buffer,
    blob: async () => new Blob([body.slice()]),
  }) as unknown as Response;

const okResponse = () => bodyResponse(pdfBytes());

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

function detailOf(
  result: Awaited<ReturnType<typeof stagePriceSheetAttachment>>,
) {
  return result.staged ? "" : result.detail;
}

describe("stagePriceSheetAttachment: every failure names itself", () => {
  it("names the route's status when it answers non-2xx", async () => {
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );

    const result = await stagePriceSheetAttachment(fast());

    expect(result.staged).toBe(false);
    expect(result.staged === false && result.cause).toBe("http-error");
    expect(detailOf(result)).toContain("HTTP 500");
    expect(detailOf(result)).toContain(PRICE_SHEET_URL);
  });

  it("names the thrown error when the fetch itself dies", async () => {
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await stagePriceSheetAttachment(fast());

    expect(result.staged).toBe(false);
    expect(result.staged === false && result.cause).toBe("fetch-failed");
    expect(detailOf(result)).toContain("network down");
  });

  it("rejects a 200 whose body is not a PDF, rather than smuggling it past the accept filter", async () => {
    // The File is built with `type:"application/pdf"` so the composer's accept
    // filter takes it — which means an HTML error page served with 200 would sail
    // straight through and the model would be told to read costs off a web page.
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        bodyResponse(
          new TextEncoder().encode("<!doctype html><h1>500 — route threw</h1>"),
        ),
      ),
    );

    const result = await stagePriceSheetAttachment(fast());

    expect(result.staged).toBe(false);
    expect(result.staged === false && result.cause).toBe("not-a-pdf");
    expect(detailOf(result)).toContain("not a PDF");
    // Nothing was pushed at the composer at all.
    expect(queuedChipCount()).toBe(0);
  });

  it("rejects a 200 with an empty body", async () => {
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => bodyResponse(new Uint8Array())),
    );

    const result = await stagePriceSheetAttachment(fast());

    expect(result.staged).toBe(false);
    expect(result.staged === false && result.cause).toBe("empty-body");
    expect(detailOf(result)).toContain("EMPTY");
  });

  it("names the missing composer file input — the formerly silent path", async () => {
    mountComposer({ fileInput: false });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const result = await stagePriceSheetAttachment(fast());

    expect(result.staged).toBe(false);
    expect(result.staged === false && result.cause).toBe("no-file-input");
    expect(detailOf(result)).toContain(PRICE_SHEET_FILE_INPUT_SELECTOR);
  });

  it("does NOT claim staged when the composer silently REJECTED the file", async () => {
    // `processFiles` drops a file failing accept/maxSize and calls an
    // `onUploadFailed` this app never wires, so the only trace is a chip that
    // never appears. Dispatching `change` is a request, not an outcome.
    mountComposer({ rejectFile: true });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const result = await stagePriceSheetAttachment(fast());

    expect(result.staged).toBe(false);
    expect(result.staged === false && result.cause).toBe("rejected");
    expect(detailOf(result)).toContain("rejected");
  });

  it("does NOT claim staged while the file is still ENCODING", async () => {
    // `consumeAttachments` hands over only `ready` files and `onSubmitInput`
    // refuses to send while anything is `uploading`. A chip in the queue is not
    // a sendable attachment.
    mountComposer({ encodeMs: "never" });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const result = await stagePriceSheetAttachment(fast({ readyMs: 0 }));

    expect(result.staged).toBe(false);
    expect(result.staged === false && result.cause).toBe("encode-timeout");
    // The file WAS accepted — the queue holds it — it just is not ready.
    expect(queuedChipCount()).toBe(1);
  });

  it("stages only once the chip is queued AND finished encoding", async () => {
    mountComposer({ encodeMs: 10 });
    vi.stubGlobal("fetch", vi.fn(okResponse));
    const changes = vi.fn();
    document.body.addEventListener("change", changes);

    const result = await stagePriceSheetAttachment(fast());

    expect(result.staged).toBe(true);
    const input = document.querySelector<HTMLInputElement>(
      PRICE_SHEET_FILE_INPUT_SELECTOR,
    );
    expect(input?.files?.[0]?.name).toBe(PRICE_SHEET_FILENAME);
    expect(changes).toHaveBeenCalled();
    expect(
      document.querySelector(ATTACHMENT_QUEUE_SELECTOR)?.textContent,
    ).toContain(PRICE_SHEET_FILENAME);
  });
});

describe("sendRestockRequestWithPriceSheet: never sends an unattached prompt", () => {
  it.each([
    [
      "the route answers 500",
      () =>
        vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
      {},
      {},
      "HTTP 500",
    ],
    [
      "the fetch throws",
      () =>
        vi.fn(async () => {
          throw new Error("network down");
        }),
      {},
      {},
      "network down",
    ],
    [
      "the body is an HTML error page, not a PDF",
      () =>
        vi.fn(async () =>
          bodyResponse(new TextEncoder().encode("<!doctype html>nope")),
        ),
      {},
      {},
      "not a PDF",
    ],
    [
      "the composer's file input is gone",
      () => vi.fn(okResponse),
      { fileInput: false },
      {},
      PRICE_SHEET_FILE_INPUT_SELECTOR,
    ],
    [
      "the composer REJECTED the file",
      () => vi.fn(okResponse),
      { rejectFile: true },
      {},
      "rejected by the attachment filter",
    ],
    [
      "the file is still encoding",
      () => vi.fn(okResponse),
      { encodeMs: "never" as const },
      { readyMs: 0 },
      "never finished encoding",
    ],
  ])(
    "aborts, and says so, when %s",
    async (_label, makeFetch, dom: ComposerOptions, budget, expectedText) => {
      mountComposer(dom);
      vi.stubGlobal("fetch", makeFetch());

      const sent = await sendRestockRequestWithPriceSheet(fast(budget));

      expect(sent).toBe(false);
      // THE assertion. Without the sheet the model invents the costs, so the
      // prompt must not reach the composer at all.
      expect(sendClicks).not.toHaveBeenCalled();
      expect(
        document.querySelector<HTMLTextAreaElement>(CHAT_TEXTAREA_SELECTOR)
          ?.value,
      ).toBe("");
      // Every failure surfaces, in the log AND on the screen.
      expect(errorSpy).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalled();
      expect(surfacedText()).toContain(expectedText);
    },
  );

  it("aborts BEFORE staging when the composer cannot be driven", async () => {
    // A framework test-id rename. This used to return early AFTER staging and
    // AFTER onSuggestionSelect had claimed the click, making the pill a total
    // no-op. It must now bail before touching the network, so no attachment is
    // left stranded in a composer we cannot submit.
    mountComposer({ textarea: false });
    const fetchSpy = vi.fn(okResponse);
    vi.stubGlobal("fetch", fetchSpy);

    const sent = await sendRestockRequestWithPriceSheet(fast());

    expect(sent).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
    expect(surfacedText()).toContain(CHAT_TEXTAREA_SELECTOR);
  });

  it("does NOT click a STOP button — that would cancel the run, not send", async () => {
    // One button plays both roles (CopilotChatInput.tsx:520-530, 540-547). Mid-run
    // it is a Stop button and a click aborts the run: the beat would then have
    // killed the presenter's demo AND reported success.
    mountComposer({ sendRole: "stop" });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendRestockRequestWithPriceSheet(fast());

    expect(sent).toBe(false);
    expect(sendClicks).not.toHaveBeenCalled();
    expect(surfacedText()).toContain("STOP button");
    expect(surfacedText()).toContain("CANCEL");
  });

  it("does NOT click a DISABLED send button", async () => {
    // `canSend` never flips — React did not register the prompt. The old code
    // clicked anyway, which dispatches nothing, and resolved `true`.
    mountComposer({ neverEnableSend: true });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendRestockRequestWithPriceSheet(
      fast({ sendableMs: 0 }),
    );

    expect(sent).toBe(false);
    expect(sendClicks).not.toHaveBeenCalled();
    expect(surfacedText()).toContain("stayed disabled");
  });

  it("does NOT click a button whose role it cannot identify", async () => {
    // A lucide rename. Failing CLOSED matters: the unknown button might be Stop.
    mountComposer({ sendRole: "unrecognized" });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendRestockRequestWithPriceSheet(
      fast({ sendableMs: 0 }),
    );

    expect(sent).toBe(false);
    expect(sendClicks).not.toHaveBeenCalled();
    expect(surfacedText()).toContain("role cannot be identified");
  });

  it("does NOT claim success when React's textarea value setter is gone", async () => {
    // The setter used to be invoked as `setter?.call(...)`, optional-chaining away
    // the only failure available and then dispatching an `input` event carrying
    // the STALE value.
    const proto = window.HTMLTextAreaElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "value");
    expect(original?.set).toBeTypeOf("function");
    // `set: undefined` is REQUIRED, not decorative: defineProperty leaves omitted
    // attributes of an EXISTING property unchanged, so omitting it silently keeps
    // jsdom's real setter and this test would pass against the broken code.
    Object.defineProperty(proto, "value", {
      configurable: true,
      enumerable: original?.enumerable,
      get: original?.get,
      set: undefined,
    });
    try {
      mountComposer();
      vi.stubGlobal("fetch", vi.fn(okResponse));

      const sent = await sendRestockRequestWithPriceSheet(fast());

      expect(sent).toBe(false);
      expect(sendClicks).not.toHaveBeenCalled();
      expect(surfacedText()).toContain(
        "could not be written into the composer",
      );
    } finally {
      Object.defineProperty(proto, "value", original!);
    }
  });

  it("does NOT claim the send when the click never consumed the attachment", async () => {
    // The click is a request too. If `consumeAttachments` never runs, the sheet is
    // still sitting in the queue and nothing carrying it went out.
    mountComposer({ consumeOnSend: false });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendRestockRequestWithPriceSheet(
      fast({ consumedMs: 0 }),
    );

    expect(sent).toBe(false);
    expect(sendClicks).toHaveBeenCalledTimes(1);
    expect(surfacedText()).toContain("unconfirmed");
    // The ONE case where "nothing was sent" would be a lie — a message may be in
    // flight, and telling the presenter otherwise invites a double send.
    expect(surfacedText()).not.toContain("nothing was sent");
    expect(surfacedText()).toContain("Could not confirm");
  });

  it("sends the prompt with the sheet on the happy path", async () => {
    mountComposer({ encodeMs: 10 });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendRestockRequestWithPriceSheet(fast());

    expect(sent).toBe(true);
    expect(sendClicks).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector<HTMLTextAreaElement>(CHAT_TEXTAREA_SELECTOR)
        ?.value,
    ).toBe(RESTOCK_PLAN_MESSAGE);
    // Consumed: the attachment rode the message out.
    expect(queuedChipCount()).toBe(0);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("attachPriceSheetByHand: the paperclip fallback is the loudest link", () => {
  it("reports rather than resolving quietly when staging fails", async () => {
    mountComposer({ fileInput: false });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const attached = await attachPriceSheetByHand(fast());

    expect(attached).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
  });

  it("does not claim the sheet is attached while it is still encoding", async () => {
    // The paperclip's contract is "the sheet is now attached", and an attachment
    // stuck in `uploading` is one the composer would refuse to send.
    mountComposer({ encodeMs: "never" });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const attached = await attachPriceSheetByHand(fast({ readyMs: 0 }));

    expect(attached).toBe(false);
    expect(surfacedText()).toContain("never finished encoding");
    // It never claims a send it did not attempt.
    expect(surfacedText()).not.toContain("nothing was sent");
  });

  it("resolves true and stays quiet when it works", async () => {
    mountComposer({ encodeMs: 10 });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    await expect(attachPriceSheetByHand(fast())).resolves.toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
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
    // report is synchronous (the guard runs before the first await), which is
    // exactly why the composer lookup moved ahead of staging.
    mountComposer({ textarea: false, sendButton: false });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    expect(commerce.onSuggestionSelect?.(pill, 4)).toBe(true);

    expect(alertSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
