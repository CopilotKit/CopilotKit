import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The composer selectors are NOT on the `@/shell/attach` barrel — it exports the
// three entry points and their types, deliberately, because no skin CALL SITE
// needs a selector. A test driving the real DOM does, so it reaches one level in.
import {
  ATTACHMENT_CHIP_SELECTOR,
  ATTACHMENT_QUEUE_SELECTOR,
  CHAT_TEXTAREA_SELECTOR,
} from "@/shell/attach/stage-attachment";
import * as store from "./data/store";
import {
  HOTEL_CONFIRMATIONS,
  hotelConfirmationFor,
} from "./data/hotel-confirmations";
import {
  attachHotelConfirmationByHand,
  sendHotelConfirmationMessage,
  HOTEL_CONFIRMATION_MESSAGE,
} from "./attach-hotel-confirmation";

/**
 * What is left to test in airline once the chain is shell-owned.
 *
 * The fifteen detection causes, the bounded condition waits, the abort rule and
 * the dual reporting are verified ONCE, in
 * `src/shell/attach/stage-attachment.test.ts`. Re-driving them here would assert
 * the same module a fourth time.
 *
 * Three things are genuinely airline's, and all three are silent when wrong:
 *
 *   1. **The three parameters** — a URL, a filename and a message. A wrong URL
 *      404s and the pill aborts (loud, recoverable); a wrong MESSAGE is the
 *      dangerous one, because the pill still sends, just not the prompt the beat
 *      needs. They are asserted against hardcoded literals, never against the
 *      module's own constants: a test that imports the value it checks cannot
 *      notice the value changing.
 *   2. **The URL names a booking the substrate can still serve.** A reseed that
 *      moves AV1423 to another city makes `hotelConfirmationFor` decline, the
 *      route 404, and beat 3d disappear with only "HTTP 404" to show for it.
 *   3. **The filename matches the one the route derives.** The chain never reads
 *      the response header, so a drifted confirmation number would print a name
 *      on the composer chip that the document itself does not carry.
 *
 * `skin.onSuggestionSelect` is NOT asserted here — this slot does not own
 * `skin.tsx` or `suggestions.ts`, and the pill is not wired yet.
 *
 * Driven against the real chain and a fake composer rather than a mocked
 * `@/shell/attach`, because a mock would prove airline passes three values to a
 * function and nothing about whether those values work.
 */

/**
 * jsdom implements no drag-and-drop, so it ships no `DataTransfer` — and that is
 * the only way to build a `FileList`, which is what `input.files` demands.
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

// ── the composer, as CopilotChat actually behaves ───────────────────────────

interface ComposerOptions {
  textarea?: boolean;
  sendButton?: boolean;
  /**
   * How long base64 encoding takes before the chip flips `uploading` → `ready`
   * and the queue starts printing the filename. A chip in the queue is not yet a
   * sendable attachment.
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

  // The queue is mounted ONLY while non-empty, so it starts absent and is
  // created on the first accepted file.
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
  input.setAttribute("accept", "application/pdf,text/csv,image/*");
  // jsdom's `files` setter runs a webidl conversion that only accepts a real
  // jsdom FileList wrapper, which no stub can produce. Replace the accessor with
  // a plain data property so the production `input.files = dt.files` is an
  // ordinary write — otherwise the assignment throws, the production catch turns
  // it into a reported failure, and every fail-loud assertion below would pass
  // for the wrong reason.
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
      // The chip renders an EMPTY body while uploading — no filename yet.
      const remove = document.createElement("button");
      remove.setAttribute("aria-label", "Remove attachment");
      chip.appendChild(remove);
      chip.dataset.ready = "false";
      ensureQueue().appendChild(chip);

      setTimeout(() => {
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
    // mark to tell SEND from STOP.
    mark.className = "lucide-arrow-up";
    btn.appendChild(mark);
    btn.disabled = true;
    btn.addEventListener("click", () => {
      sendClicks();
      if (btn?.disabled) return; // a real disabled button dispatches nothing
      // consumeAttachments(): every READY chip leaves the queue.
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
const pdfBytes = () =>
  new TextEncoder().encode("%PDF-1.4\nhotel confirmation\n%%EOF");

const okResponse = () =>
  ({
    ok: true,
    status: 200,
    arrayBuffer: async () => pdfBytes().slice().buffer,
    blob: async () => new Blob([pdfBytes().slice()]),
  }) as unknown as Response;

let errorSpy: MockInstance;
let alertSpy: MockInstance;

beforeEach(() => {
  store.reset();
  vi.stubGlobal("DataTransfer", DataTransferStub);
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

// The three values that are airline's, written out rather than imported.
const EXPECTED_URL = "/api/airline/v1/hotel-confirmation?booking=bkg-av1423";
const EXPECTED_FILENAME = "hotel-confirmation-cm-77q4132.pdf";
const EXPECTED_MESSAGE = "Read my hotel confirmation and file the trip brief.";

describe("the three airline values", () => {
  it("names a booking the substrate can still serve a confirmation for", () => {
    // A reseed that moves AV1423 to another city, renames Camila, or drops the
    // booking makes `hotelConfirmationFor` decline — the route 404s, the chain
    // aborts, and beat 3d silently disappears from the demo.
    const booking = store.findBooking("bkg-av1423");
    expect(booking).toBeDefined();
    expect(
      hotelConfirmationFor({
        booking,
        flights: store.flights(),
        travelers: store.travelers(),
      }),
    ).toBeDefined();
  });

  it("prints the filename the route itself derives", () => {
    // `GET /hotel-confirmation` builds its `content-disposition` from the
    // confirmation number; the composer chip prints OURS. They are two copies of
    // one string, so this is the drift guard between them.
    const entry = HOTEL_CONFIRMATIONS.find((e) => e.bookingId === "bkg-av1423");
    expect(entry).toBeDefined();
    expect(EXPECTED_FILENAME).toBe(
      `hotel-confirmation-${entry!.confirmationNumber.toLowerCase()}.pdf`,
    );
  });

  it("keeps the pill's message and the interception on ONE string", () => {
    // The dangerous parameter: a drifted message still sends, just without the
    // file, and the model then invents the document's contents.
    expect(HOTEL_CONFIRMATION_MESSAGE).toBe(EXPECTED_MESSAGE);
  });
});

describe("sendHotelConfirmationMessage", () => {
  it("fetches the confirmation route, attaches it under its own filename, and sends the beat-3d prompt", async () => {
    mountComposer({ encodeMs: 10 });
    const fetchSpy = vi.fn(okResponse);
    vi.stubGlobal("fetch", fetchSpy);

    const sent = await sendHotelConfirmationMessage();

    expect(sent).toBe(true);
    // 1 — the URL, booking named rather than defaulted.
    expect(fetchSpy).toHaveBeenCalledWith(EXPECTED_URL);
    // 2 — the filename, read off the File the composer was actually handed. It
    // cannot be read off the chip here: a confirmed send has CONSUMED the chip.
    expect(
      document.querySelector<HTMLInputElement>(
        'input[type="file"][accept*="pdf"]',
      )?.files?.[0]?.name,
    ).toBe(EXPECTED_FILENAME);
    // 3 — the message.
    expect(
      document.querySelector<HTMLTextAreaElement>(CHAT_TEXTAREA_SELECTOR)
        ?.value,
    ).toBe(EXPECTED_MESSAGE);
    expect(sendClicks).toHaveBeenCalledTimes(1);
    // Consumed: the attachment rode the message out.
    expect(queuedChipCount()).toBe(0);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("aborts the send, loudly, when the confirmation route fails", async () => {
    // One representative failure, not the taxonomy. What is asserted here is
    // that airline is wired to a chain that ABORTS: without the document the
    // model invents the hotel's cutoff and the brief is filed anyway — which is
    // the one outcome that makes beat 3d prove the opposite of its claim.
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response),
    );

    const sent = await sendHotelConfirmationMessage();

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

describe("attachHotelConfirmationByHand: the paperclip fallback", () => {
  it("attaches the confirmation and sends nothing", async () => {
    mountComposer({ encodeMs: 10 });
    const fetchSpy = vi.fn(okResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(attachHotelConfirmationByHand()).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith(EXPECTED_URL);
    // The chip PRINTS the filename — the signal the chain waits on to know
    // base64 encoding finished, and the one thing a presenter can see.
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

    await expect(attachHotelConfirmationByHand()).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
    // It never intended to send, so it must not claim a send failed.
    expect(surfacedText()).not.toContain("nothing was sent");
  });
});
