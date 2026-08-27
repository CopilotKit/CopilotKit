import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AttachmentDocument,
  AttachmentFailureCause,
  Beat3dTimings,
} from "./stage-attachment";
import {
  ATTACHMENT_CHIP_SELECTOR,
  ATTACHMENT_FILE_INPUT_SELECTOR,
  ATTACHMENT_QUEUE_SELECTOR,
  CHAT_SEND_BUTTON_SELECTOR,
  CHAT_TEXTAREA_SELECTOR,
  attachByHand,
  sendMessageWithAttachment,
  stageAttachment,
} from "./stage-attachment";

/**
 * BEAT 3d's failure contract, now owned by the shell.
 *
 * The beat claims a REAL document was ingested into a durable artifact. The
 * catastrophic failure is not "the beat did not run" — it is "the prompt was
 * sent with NO attachment", because the model then invents the document's
 * contents, the artifact is still filed, and it reads plausibly. The demo looks
 * perfect while proving the opposite of its point.
 *
 * The defect CLASS these tests exist to make unrepresentable is broader than any
 * one bug: **an async DOM-driving step that resolves `true` without confirming
 * its effect.** Fetching, staging, encoding and clicking are all REQUESTS made of
 * code we do not own; each one has to be observed. So the file asserts:
 *
 *   1. the prompt is not sent unless the document is queued AND finished
 *      encoding — for every way each of those can fail;
 *   2. the send is not claimed unless the click actually consumed the attachment;
 *   3. every failure surfaces something a presenter can see (`console.error` for
 *      the log AND `window.alert` for the stage) and names ITSELF, because "retry
 *      the pill", "press send by hand" and "restart the dev server" are different
 *      instructions;
 *   4. EVERY negative path leaves the send unfired — the assertion that makes the
 *      beat honest rather than merely well-behaved.
 *
 * Written against the DOM rather than a render because the whole mechanism IS
 * DOM manipulation: it reaches for framework-owned elements by test id. What the
 * fake composer below reproduces is not React, it is the framework's observable
 * ATTACHMENT STATE MACHINE, which is the thing being verified.
 */

/** Stands in for whatever a skin generates; only these two values are per-skin. */
const DOC: AttachmentDocument = {
  url: "/api/demo/v1/price-sheet",
  filename: "price-sheet-kestrel-mills.pdf",
};
const MESSAGE = "Read the attached price sheet and file the restock plan.";

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
 * Fast budgets. Production waits SECONDS because a real encode can take them; a
 * test that spent the real budget on each expiry branch would add half a minute
 * to the suite — and a test that actually sleeps for `readyMs` gets deleted by
 * the next person to notice. `0` forces the expiry branch deterministically:
 * `waitUntil` still evaluates its predicate, so a condition that is already true
 * still passes with a `0` budget.
 */
const FAST: Beat3dTimings = {
  acceptMs: 40,
  readyMs: 40,
  sendableMs: 40,
  consumedMs: 40,
  pollMs: 5,
};
const fast = (over: Partial<Beat3dTimings> = {}): Beat3dTimings => ({
  ...FAST,
  ...over,
});

/**
 * Budgets for the paths that SUCCEED — and the reason this file has two sets.
 *
 * `FAST`'s 40ms is a CEILING, not a duration, and the two kinds of test want
 * opposite things from it:
 *
 *   - An EXPIRY test wants it spent, so it must be small. Those tests drive the
 *     branch they mean to (`readyMs: 0`, `sendableMs: 0`, `consumedMs: 0`) or
 *     lean on a small `acceptMs` for the "rejected" paths.
 *   - A SUCCESS test never reaches the ceiling at all: `waitUntil` returns the
 *     moment its predicate holds. So a generous ceiling costs ZERO wall clock
 *     here — it buys nothing but headroom.
 *
 * Sharing `FAST` with the success paths made them race. `waitUntil` measures its
 * budget with `Date.now()`, so a vitest worker descheduled under load spends the
 * budget without the event loop ever running the timer it is waiting for: a 40ms
 * ceiling around a real 10ms encode is a ~4x margin, which a loaded box loses.
 * That is a property of the TEST HARNESS, never of the code under test, so it is
 * fixed here rather than by loosening any assertion.
 */
const PATIENT: Beat3dTimings = {
  acceptMs: 5_000,
  readyMs: 5_000,
  sendableMs: 5_000,
  consumedMs: 5_000,
  pollMs: 5,
};
const patient = (over: Partial<Beat3dTimings> = {}): Beat3dTimings => ({
  ...PATIENT,
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
   *
   * `"manual"` hands the transition to the test via the returned
   * `finishEncoding()`, so the chip sits `uploading` for exactly as long as the
   * test wants and flips on demand. That is what lets the ordering assertion —
   * queued is NOT enough, encoded is what unblocks staging — be driven rather
   * than TIMED. A number races the budget; a latch cannot.
   */
  encodeMs?: number | "never" | "manual";
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
  /** Makes `.click()` itself throw, to reach the outermost catch. */
  clickThrows?: boolean;
  /**
   * Removes the one browser API here with no jsdom implementation, so writing
   * the file onto the input throws. Part of the composer's ENVIRONMENT rather
   * than its DOM, which is why it lives on this fixture with the rest.
   */
  dataTransferBroken?: boolean;
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
  clickThrows = false,
  dataTransferBroken = false,
}: ComposerOptions = {}) {
  document.body.innerHTML = "";

  if (dataTransferBroken) {
    vi.stubGlobal(
      "DataTransfer",
      class {
        constructor() {
          throw new Error("DataTransfer is not available");
        }
      },
    );
  }

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

  // `"manual"` encode state: the chip waiting to be flipped, the file whose name
  // it will print, and whether the test asked for the flip before the chip had
  // even been created (the change handler runs a tick later, so the latch has to
  // survive that gap).
  let pendingChip: HTMLElement | null = null;
  let pendingName: string | null = null;
  let encodeRequested = false;

  /** The `uploading` → `ready` transition: DocumentPreview starts printing the name. */
  const markReady = (chip: HTMLElement, name: string) => {
    const label = document.createElement("span");
    label.textContent = name;
    chip.insertBefore(label, chip.querySelector(ATTACHMENT_CHIP_SELECTOR));
    chip.dataset.ready = "true";
  };

  const finishEncoding = () => {
    encodeRequested = true;
    if (pendingChip && pendingName !== null) {
      markReady(pendingChip, pendingName);
      pendingChip = null;
      pendingName = null;
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
        if (encodeMs === "manual") {
          // Hand the chip to `finishEncoding()`. If the test already asked for
          // the flip, honour it now — but a test asserting the ORDERING calls it
          // only after observing the chip queued, so that path stays unused there.
          pendingChip = chip;
          pendingName = picked.name;
          if (encodeRequested) finishEncoding();
          return;
        }
        setTimeout(() => {
          // `ready`: DocumentPreview prints the filename
          // (CopilotChatAttachmentQueue.tsx:357-359).
          markReady(chip, picked.name);
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
    if (clickThrows) {
      btn.click = () => {
        throw new Error("the composer blew up mid-click");
      };
    }
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

  // Only meaningful under `encodeMs: "manual"`; harmless everywhere else, which
  // is why every other call site can keep ignoring the return.
  return { finishEncoding };
}

/**
 * Await a DOM condition the FIXTURE will bring about, with a ceiling far larger
 * than the thing being waited for. Deliberately not a fixed sleep: the point is
 * to resume the instant the condition holds, so a loaded worker changes how long
 * this takes and never whether it succeeds.
 */
async function waitForDom(
  predicate: () => boolean,
  what: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Long enough for the production poll loop (`pollMs` 5) to run many times over,
 * so "it still has not resolved" is a finding rather than an artefact of looking
 * too early. Sized against the loop's cadence, not against an encode.
 */
const SETTLE_WINDOW_MS = 100;
const settleWindow = () =>
  new Promise((resolve) => setTimeout(resolve, SETTLE_WINDOW_MS));

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

/**
 * The whole point of `reportAttachmentFailure` taking a machine-readable cause:
 * on the SEND path the entry points return a bare boolean, so the tagged log
 * line is the only place a test can read WHICH failure fired. Matching prose
 * instead would make every message edit a test edit.
 */
function reportedFailure(): { cause: AttachmentFailureCause; message: string } {
  for (const call of errorSpy.mock.calls) {
    const match = /^\[attach:([a-z-]+)]\s+([\s\S]*)$/.exec(String(call[0]));
    if (match) {
      return {
        cause: match[1] as AttachmentFailureCause,
        message: match[2] ?? "",
      };
    }
  }
  throw new Error(
    `No tagged failure was reported. Surfaced instead:\n${surfacedText()}`,
  );
}

/**
 * Every cause a test in this file actually drove, with the sentence it carried.
 * DELIBERATELY module-level and never cleared: the contract test at the bottom
 * counts it, so a cause no test drives is a cause that fails that count. (It
 * therefore only holds when the whole file runs — running one test with `-t`
 * will fail the last one.)
 */
const observed = new Map<AttachmentFailureCause, string>();

function observe(cause: AttachmentFailureCause, detail: string) {
  observed.set(cause, detail);
  return cause;
}

/** Record a staging result's cause + detail, and hand the cause back to assert on. */
function observedCause(
  result: Awaited<ReturnType<typeof stageAttachment>>,
): AttachmentFailureCause | true {
  if (result.staged) return true;
  return observe(result.cause, result.detail);
}

function detailOf(result: Awaited<ReturnType<typeof stageAttachment>>) {
  return result.staged ? "" : result.detail;
}

/** Record whatever the send path reported, and hand the cause back. */
function observedReport(): AttachmentFailureCause {
  const { cause, message } = reportedFailure();
  return observe(cause, message);
}

describe("stageAttachment: every failure names itself, and none of them send", () => {
  it("names the route's status when it answers non-2xx", async () => {
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );

    const result = await stageAttachment(DOC, fast());

    expect(observedCause(result)).toBe("http-error");
    expect(detailOf(result)).toContain("HTTP 500");
    expect(detailOf(result)).toContain(DOC.url);
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("names the thrown error when the fetch itself dies", async () => {
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await stageAttachment(DOC, fast());

    expect(observedCause(result)).toBe("fetch-failed");
    expect(detailOf(result)).toContain("network down");
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("rejects a 200 with an empty body", async () => {
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => bodyResponse(new Uint8Array())),
    );

    const result = await stageAttachment(DOC, fast());

    expect(observedCause(result)).toBe("empty-body");
    expect(detailOf(result)).toContain("EMPTY");
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("rejects a 200 whose body is not a PDF, rather than smuggling it past the accept filter", async () => {
    // The File is built with `type:"application/pdf"` so the composer's accept
    // filter takes it — which means an HTML error page served with 200 would sail
    // straight through and the model would be told to read numbers off a web page.
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        bodyResponse(
          new TextEncoder().encode("<!doctype html><h1>500 — route threw</h1>"),
        ),
      ),
    );

    const result = await stageAttachment(DOC, fast());

    expect(observedCause(result)).toBe("not-a-pdf");
    expect(detailOf(result)).toContain("not a PDF");
    // Nothing was pushed at the composer at all.
    expect(queuedChipCount()).toBe(0);
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("names the missing composer file input — the formerly silent path", async () => {
    mountComposer({ fileInput: false });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const result = await stageAttachment(DOC, fast());

    expect(observedCause(result)).toBe("no-file-input");
    expect(detailOf(result)).toContain(ATTACHMENT_FILE_INPUT_SELECTOR);
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("blames the DOM write, not the fetch, when staging throws", async () => {
    // `DataTransfer` is the one browser API here with no jsdom implementation and
    // no polyfill guarantee; when it (or `File`) is unavailable the write throws.
    // The failure must name the WRITE — the file-wide catch this replaced sent
    // presenters off to check a perfectly healthy network.
    mountComposer({ dataTransferBroken: true });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const result = await stageAttachment(DOC, fast());

    expect(observedCause(result)).toBe("staging-threw");
    expect(detailOf(result)).toContain("DataTransfer is not available");
    expect(queuedChipCount()).toBe(0);
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("does NOT claim staged when the composer silently REJECTED the file", async () => {
    // `processFiles` drops a file failing accept/maxSize and calls an
    // `onUploadFailed` this app never wires, so the only trace is a chip that
    // never appears. Dispatching `change` is a request, not an outcome.
    mountComposer({ rejectFile: true });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const result = await stageAttachment(DOC, fast());

    expect(observedCause(result)).toBe("rejected");
    expect(detailOf(result)).toContain("rejected");
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("does NOT claim staged while the file is still ENCODING", async () => {
    // `consumeAttachments` hands over only `ready` files and `onSubmitInput`
    // refuses to send while anything is `uploading`. A chip in the queue is not
    // a sendable attachment.
    mountComposer({ encodeMs: "never" });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const result = await stageAttachment(DOC, fast({ readyMs: 0 }));

    expect(observedCause(result)).toBe("encode-timeout");
    // The file WAS accepted — the queue holds it — it just is not ready.
    expect(queuedChipCount()).toBe(1);
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("stages only once the chip is queued AND finished encoding", async () => {
    // The two halves of the property are asserted SEPARATELY, in order, against
    // an encode the test itself releases. The previous shape ran a real 10ms
    // encode against a 40ms budget and read only the END state, so it inferred
    // "waited for ready" from "ready by the time it finished" — which a slow
    // worker turns into a false failure and a fast one could turn into a false
    // pass. Latching the encode makes the ordering observable instead.
    const composer = mountComposer({ encodeMs: "manual" });
    vi.stubGlobal("fetch", vi.fn(okResponse));
    const changes = vi.fn();
    document.body.addEventListener("change", changes);

    let settled = false;
    const staging = stageAttachment(DOC, patient()).then((value) => {
      settled = true;
      return value;
    });

    // HALF ONE: queued is NOT enough. The chip is in the queue and the file is
    // on the input, and staging is still outstanding because nothing has
    // finished encoding.
    await waitForDom(() => queuedChipCount() === 1, "the chip to be queued");
    expect(changes).toHaveBeenCalled();
    const input = document.querySelector<HTMLInputElement>(
      ATTACHMENT_FILE_INPUT_SELECTOR,
    );
    expect(input?.files?.[0]?.name).toBe(DOC.filename);
    // The queue prints nothing while `uploading` — that absence IS the state.
    expect(
      document.querySelector(ATTACHMENT_QUEUE_SELECTOR)?.textContent,
    ).not.toContain(DOC.filename);
    // Give the production poll loop a genuine chance to resolve before claiming
    // it did not. Sampling `settled` the instant the chip appears proves nothing
    // — the accept wait has not even re-run its predicate yet, so the flag reads
    // `false` whether or not the ready wait exists at all (verified by deleting
    // that wait: this test passed regardless until the window was added).
    //
    // The window is the ONE unavoidable wait-and-see in the file, and its
    // fragility points the safe way: a starved worker makes staging LESS likely
    // to resolve, so load can only make this pass. It cannot manufacture the
    // false failure this rewrite exists to remove.
    await settleWindow();
    expect(settled).toBe(false);

    // HALF TWO: encoding finishes, and only now may staging report success.
    composer.finishEncoding();
    const result = await staging;

    expect(result.staged).toBe(true);
    expect(
      document.querySelector(ATTACHMENT_QUEUE_SELECTOR)?.textContent,
    ).toContain(DOC.filename);
    // Staging never sends — that is the caller's job.
    expect(sendClicks).not.toHaveBeenCalled();
  });
});

describe("sendMessageWithAttachment: never sends an unattached prompt", () => {
  it.each([
    [
      "the route answers 500",
      () =>
        vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
      {},
      {},
      "http-error" as const,
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
      "fetch-failed" as const,
      "network down",
    ],
    [
      "the body is empty",
      () => vi.fn(async () => bodyResponse(new Uint8Array())),
      {},
      {},
      "empty-body" as const,
      "EMPTY",
    ],
    [
      "the body is an HTML error page, not a PDF",
      () =>
        vi.fn(async () =>
          bodyResponse(new TextEncoder().encode("<!doctype html>nope")),
        ),
      {},
      {},
      "not-a-pdf" as const,
      "not a PDF",
    ],
    [
      "the composer's file input is gone",
      () => vi.fn(okResponse),
      { fileInput: false },
      {},
      "no-file-input" as const,
      ATTACHMENT_FILE_INPUT_SELECTOR,
    ],
    [
      "writing the file onto the input throws",
      () => vi.fn(okResponse),
      { dataTransferBroken: true },
      {},
      "staging-threw" as const,
      "Writing the file onto the composer's hidden input threw",
    ],
    [
      "the composer REJECTED the file",
      () => vi.fn(okResponse),
      { rejectFile: true },
      {},
      "rejected" as const,
      "rejected by the attachment filter",
    ],
    [
      "the file is still encoding",
      () => vi.fn(okResponse),
      { encodeMs: "never" as const },
      { readyMs: 0 },
      "encode-timeout" as const,
      "never finished encoding",
    ],
  ])(
    "aborts, and says so, when %s",
    async (
      _label,
      makeFetch,
      dom: ComposerOptions,
      budget,
      expectedCause,
      expectedText,
    ) => {
      mountComposer(dom);
      vi.stubGlobal("fetch", makeFetch());

      const sent = await sendMessageWithAttachment(DOC, MESSAGE, fast(budget));

      expect(sent).toBe(false);
      // THE assertion. Without the document the model invents its contents, so
      // the prompt must not reach the composer at all.
      expect(sendClicks).not.toHaveBeenCalled();
      expect(
        document.querySelector<HTMLTextAreaElement>(CHAT_TEXTAREA_SELECTOR)
          ?.value,
      ).toBe("");
      // Every failure surfaces, in the log AND on the screen.
      expect(errorSpy).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalled();
      expect(observedReport()).toBe(expectedCause);
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

    const sent = await sendMessageWithAttachment(DOC, MESSAGE, fast());

    expect(sent).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendClicks).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
    expect(observedReport()).toBe("no-composer");
    expect(surfacedText()).toContain(CHAT_TEXTAREA_SELECTOR);
    expect(surfacedText()).toContain(CHAT_SEND_BUTTON_SELECTOR);
  });

  it("does NOT click a STOP button — that would cancel the run, not send", async () => {
    // One button plays both roles (CopilotChatInput.tsx:520-530, 540-547). Mid-run
    // it is a Stop button and a click aborts the run: the beat would then have
    // killed the presenter's demo AND reported success.
    mountComposer({ sendRole: "stop" });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendMessageWithAttachment(DOC, MESSAGE, fast());

    expect(sent).toBe(false);
    expect(sendClicks).not.toHaveBeenCalled();
    expect(observedReport()).toBe("send-stop-state");
    expect(surfacedText()).toContain("STOP button");
    expect(surfacedText()).toContain("CANCEL");
  });

  it("does NOT click a DISABLED send button", async () => {
    // `canSend` never flips — React did not register the prompt. The old code
    // clicked anyway, which dispatches nothing, and resolved `true`.
    mountComposer({ neverEnableSend: true });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendMessageWithAttachment(
      DOC,
      MESSAGE,
      fast({ sendableMs: 0 }),
    );

    expect(sent).toBe(false);
    expect(sendClicks).not.toHaveBeenCalled();
    expect(observedReport()).toBe("send-disabled");
    expect(surfacedText()).toContain("stayed disabled");
  });

  it("does NOT click a button whose role it cannot identify", async () => {
    // A lucide rename. Failing CLOSED matters: the unknown button might be Stop.
    mountComposer({ sendRole: "unrecognized" });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendMessageWithAttachment(
      DOC,
      MESSAGE,
      fast({ sendableMs: 0 }),
    );

    expect(sent).toBe(false);
    expect(sendClicks).not.toHaveBeenCalled();
    expect(observedReport()).toBe("send-unrecognized");
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

      const sent = await sendMessageWithAttachment(DOC, MESSAGE, fast());

      expect(sent).toBe(false);
      expect(sendClicks).not.toHaveBeenCalled();
      expect(observedReport()).toBe("stale-value");
      expect(surfacedText()).toContain(
        "could not be written into the composer",
      );
    } finally {
      Object.defineProperty(proto, "value", original!);
    }
  });

  it("does NOT claim the send when the click never consumed the attachment", async () => {
    // The click is a request too. If `consumeAttachments` never runs, the document
    // is still sitting in the queue and nothing carrying it went out.
    mountComposer({ consumeOnSend: false });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendMessageWithAttachment(
      DOC,
      MESSAGE,
      fast({ consumedMs: 0 }),
    );

    expect(sent).toBe(false);
    expect(sendClicks).toHaveBeenCalledTimes(1);
    expect(observedReport()).toBe("send-unconfirmed");
    expect(surfacedText()).toContain("unconfirmed");
    // The ONE case where "nothing was sent" would be a lie — a message may be in
    // flight, and telling the presenter otherwise invites a double send.
    expect(surfacedText()).not.toContain("nothing was sent");
    expect(surfacedText()).toContain("Could not confirm");
  });

  it("reports anything that escapes a narrower handler rather than rejecting", async () => {
    // The entry points are called from DOM event handlers that cannot await, so a
    // rejection would land in an unhandled-rejection log nobody is watching. Every
    // path resolves a boolean, and the outermost catch is what guarantees it.
    mountComposer({ clickThrows: true });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendMessageWithAttachment(DOC, MESSAGE, fast());

    expect(sent).toBe(false);
    expect(observedReport()).toBe("unexpected");
    expect(surfacedText()).toContain("the composer blew up mid-click");
  });

  it("sends the prompt with the document on the happy path", async () => {
    // A real (short) encode here on purpose: this test is the end-to-end one, so
    // it should exercise the ordinary asynchronous transition rather than a
    // latch. `patient()` is what keeps that from racing — see PATIENT.
    mountComposer({ encodeMs: 10 });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const sent = await sendMessageWithAttachment(DOC, MESSAGE, patient());

    expect(sent).toBe(true);
    expect(sendClicks).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector<HTMLTextAreaElement>(CHAT_TEXTAREA_SELECTOR)
        ?.value,
    ).toBe(MESSAGE);
    // Consumed: the attachment rode the message out.
    expect(queuedChipCount()).toBe(0);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("attachByHand: the paperclip fallback is the loudest link", () => {
  it("reports rather than resolving quietly when staging fails", async () => {
    mountComposer({ fileInput: false });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const attached = await attachByHand(DOC, fast());

    expect(attached).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
    expect(reportedFailure().cause).toBe("no-file-input");
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("does not claim the document is attached while it is still encoding", async () => {
    // The paperclip's contract is "the document is now attached", and an
    // attachment stuck in `uploading` is one the composer would refuse to send.
    mountComposer({ encodeMs: "never" });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    const attached = await attachByHand(DOC, fast({ readyMs: 0 }));

    expect(attached).toBe(false);
    expect(surfacedText()).toContain("never finished encoding");
    // It never claims a send it did not attempt.
    expect(surfacedText()).not.toContain("nothing was sent");
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("keeps its own lede even when something unexpected escapes", async () => {
    // The paperclip never intended to send, so NONE of its paths may say
    // "nothing was sent". The anticipated failures above already got that right;
    // this catch used to fall back to the default lede, so the fallback for a
    // broken pill contradicted itself depending on which failure it hit. It is
    // also the only one of the module's two `unexpected` emissions that no test
    // covered.
    mountComposer();
    vi.stubGlobal("fetch", vi.fn(okResponse));
    // Thrown from the file-input lookup: the first step after the fetch that sits
    // outside any of `stageAttachment`'s own try blocks, so it reaches the
    // outermost catch exactly as an unforeseen failure would.
    const realQuerySelector = document.querySelector.bind(document);
    vi.spyOn(document, "querySelector").mockImplementation(
      (selector: string) => {
        if (selector === ATTACHMENT_FILE_INPUT_SELECTOR) {
          throw new Error("the DOM query blew up");
        }
        return realQuerySelector(selector);
      },
    );

    const attached = await attachByHand(DOC, fast());

    expect(attached).toBe(false);
    expect(reportedFailure().cause).toBe("unexpected");
    expect(surfacedText()).toContain("the DOM query blew up");
    expect(surfacedText()).not.toContain("nothing was sent");
    expect(sendClicks).not.toHaveBeenCalled();
  });

  it("resolves true and stays quiet when it works", async () => {
    mountComposer({ encodeMs: 10 });
    vi.stubGlobal("fetch", vi.fn(okResponse));

    await expect(attachByHand(DOC, patient())).resolves.toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(sendClicks).not.toHaveBeenCalled();
  });
});

/**
 * Every member of the union, listed once — the TYPE is what makes this list
 * honest, not the author. `Record<AttachmentFailureCause, true>` is exhaustive by
 * construction: add a member to the union and omit it here and `tsc` fails on
 * this object.
 *
 * The pairing with `observed` below is the whole gate, and NEITHER HALF WORKS
 * ALONE:
 *
 *   - `observed.size` alone counts only causes some test drove. A sixteenth
 *     member declared in the union and never constructed never enters the Map,
 *     the size stays 15, and the assertion passes. That is precisely the rot this
 *     module was extracted to fix — commerce declared fifteen causes and
 *     constructed eight, and no test could see the difference.
 *   - `ALL_CAUSES` alone proves only that the union was transcribed, not that any
 *     of it fires.
 *
 * Together: a new union member is a `tsc` error until it is listed here, and once
 * listed it raises the expected count until a test actually drives it.
 */
const ALL_CAUSES: Record<AttachmentFailureCause, true> = {
  "fetch-failed": true,
  "http-error": true,
  "empty-body": true,
  "not-a-pdf": true,
  "no-file-input": true,
  "staging-threw": true,
  rejected: true,
  "encode-timeout": true,
  "no-composer": true,
  "stale-value": true,
  "send-disabled": true,
  "send-stop-state": true,
  "send-unrecognized": true,
  "send-unconfirmed": true,
  unexpected: true,
};

describe("the failure contract", () => {
  it("drives every cause the union declares, and gives each its own sentence", () => {
    const declared = Object.keys(ALL_CAUSES).length;
    // Collected from the failure paths exercised ABOVE, never hand-listed. Read
    // against `declared` rather than a literal: a cause that stops being driven
    // drops the size, and a cause that is DECLARED BUT NEVER CONSTRUCTED raises
    // `declared` without raising the size. Both fail here.
    expect(observed.size).toBe(declared);
    // No two read alike: "retry the pill", "press send by hand" and "restart the
    // dev server" are different instructions, and a presenter mid-demo has to be
    // able to tell which one they were just given.
    expect(new Set(observed.values()).size).toBe(declared);
    for (const [cause, detail] of observed) {
      expect(detail.length, `${cause} says too little`).toBeGreaterThan(20);
    }
  });
});
