import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The composer selectors are NOT on the `@/shell/attach` barrel — it exports the
// entry points and their types, deliberately, because no skin CALL SITE needs a
// selector. A test driving the real DOM does, so it reaches one level in.
import {
  ATTACHMENT_CHIP_SELECTOR,
  ATTACHMENT_QUEUE_SELECTOR,
  CHAT_TEXTAREA_SELECTOR,
} from "@/shell/attach/stage-attachment";
import {
  attachBulletinByHand,
  sendBulletinMessage,
  BULLETIN_MESSAGE,
} from "@/skins/keel/attach-bulletin";

/**
 * What is left to test in keel once the chain is shell-owned.
 *
 * The fifteen detection causes, the bounded condition waits, the abort rule and
 * the dual reporting are verified ONCE, in
 * `src/shell/attach/stage-attachment.test.ts`. Re-driving them here would assert
 * the same module a fourth time.
 *
 * Three things are genuinely keel's, and all three are silent when wrong:
 *
 *   1. **The three parameters.** `attach-bulletin.ts` is nothing BUT a URL, a
 *      filename and a message. A wrong URL 404s and the pill aborts (loud,
 *      recoverable); a wrong MESSAGE is the dangerous one — the pill still
 *      sends, just not the prompt the beat needs, and the model then summarizes
 *      the bulletin into the transcript while the durable Impact Brief is never
 *      filed. So these are asserted against hardcoded literals, never against
 *      the module's own constants: a test that imports the value it checks
 *      cannot notice the value changing.
 *   2. **The SPACE is named in the URL.** Left to the route's `DEFAULT_SPACE`,
 *      a corpus rename would silently serve a different space's bulletin under a
 *      filename that says privacy.
 *   3. **The chain ABORTS rather than sending without the file.** Without the
 *      bulletin the model invents its contents and `POST /briefs` files the
 *      brief anyway — the beat proving the opposite of its claim, with nothing
 *      on screen to say so.
 *
 * `onSuggestionSelect` is NOT asserted here: the pill and the handler live in
 * `suggestions.ts` and `skin.tsx`, which a later slot owns. When that slot wires
 * them, the two assertions to add are commerce's — that the bulletin pill is
 * claimed, and that it is never claimed silently.
 *
 * Driven against the real chain and a fake composer rather than a mocked
 * `@/shell/attach`, because a mock would prove keel passes three values to a
 * function and nothing about whether those values work.
 */

/**
 * jsdom implements no drag-and-drop, so it ships no `DataTransfer` — and that is
 * the only way to build a `FileList`, which is what `input.files` demands.
 * Without this stub the happy path throws inside the production try/catch and
 * reports a failure, which would make the fail-loud assertions below pass for
 * entirely the wrong reason.
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

const sendClicks = vi.fn();

/** The composer, trimmed to the states these assertions need. */
function mountComposer({
  textarea = true,
  sendButton = true,
  encodeMs = 0,
}: { textarea?: boolean; sendButton?: boolean; encodeMs?: number } = {}) {
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

  const input = document.createElement("input");
  input.type = "file";
  input.setAttribute("accept", "application/pdf,image/*");
  // jsdom's `files` setter runs a webidl conversion that only accepts a real
  // jsdom FileList wrapper, which no stub can produce. Replace the accessor with
  // a plain data property so the production `input.files = dt.files` is an
  // ordinary write.
  Object.defineProperty(input, "files", {
    writable: true,
    configurable: true,
    value: null,
  });
  input.addEventListener("change", () => {
    const picked = input.files?.[0];
    if (!picked) return;
    setTimeout(() => {
      const chip = document.createElement("div");
      // The chip renders an EMPTY body while uploading — no filename yet.
      const remove = document.createElement("button");
      remove.setAttribute("aria-label", "Remove attachment");
      chip.appendChild(remove);
      chip.dataset.ready = "false";
      ensureQueue().appendChild(chip);

      setTimeout(() => {
        // `ready`: the preview prints the filename.
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
      const queue = document.querySelector<HTMLElement>(
        ATTACHMENT_QUEUE_SELECTOR,
      );
      if (queue && !queue.querySelectorAll(ATTACHMENT_CHIP_SELECTOR).length) {
        queue.remove();
      }
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

const queuedChipCount = () =>
  document.querySelectorAll(
    `${ATTACHMENT_QUEUE_SELECTOR} ${ATTACHMENT_CHIP_SELECTOR}`,
  ).length;

/** A real PDF body — checked on the BYTES by the shell chain. */
const pdfBytes = () => new TextEncoder().encode("%PDF-1.4\nbulletin\n%%EOF");

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
const surfacedText = () =>
  [...errorSpy.mock.calls, ...alertSpy.mock.calls]
    .map((args) => args.map(String).join(" "))
    .join("\n");

// The three values that are keel's, written out rather than imported.
const EXPECTED_URL = "/api/keel/v1/bulletin?space=privacy";
const EXPECTED_FILENAME = "bulletin-privacy.pdf";
const EXPECTED_MESSAGE =
  "Read this regulatory bulletin and file the impact brief.";

describe("the three parameters", () => {
  it("names the knowledge space rather than relying on the route's default", () => {
    // A corpus rename that retires `privacy` must 404 this fetch and abort the
    // pill, not quietly serve some other space's bulletin under this filename.
    expect(EXPECTED_URL).toContain("space=privacy");
    expect(EXPECTED_FILENAME).toContain("privacy");
  });

  it("asks for the durable artifact, not just for a reading", () => {
    // The half of the beat that belongs to the APPLICATION. A message that asks
    // only for a summary gets one, in the transcript, and no brief is ever
    // filed — which is beat 3d without its point.
    expect(BULLETIN_MESSAGE).toBe(EXPECTED_MESSAGE);
    expect(BULLETIN_MESSAGE.toLowerCase()).toContain("file the impact brief");
  });
});

describe("sendBulletinMessage", () => {
  it("fetches the privacy bulletin, attaches it under its own filename, and sends the prompt", async () => {
    mountComposer({ encodeMs: 10 });
    const fetchSpy = vi.fn(okResponse);
    vi.stubGlobal("fetch", fetchSpy);

    const sent = await sendBulletinMessage();

    expect(sent).toBe(true);
    // 1 — the URL keel passes.
    expect(fetchSpy).toHaveBeenCalledWith(EXPECTED_URL);
    // 2 — the filename, read off the File the composer was actually handed. It
    // cannot be read off the chip here: a confirmed send has CONSUMED the chip.
    expect(
      document.querySelector<HTMLInputElement>(
        'input[type="file"][accept*="pdf"]',
      )?.files?.[0]?.name,
    ).toBe(EXPECTED_FILENAME);
    // 3 — the message, the parameter that fails SILENTLY when wrong.
    expect(
      document.querySelector<HTMLTextAreaElement>(CHAT_TEXTAREA_SELECTOR)
        ?.value,
    ).toBe(EXPECTED_MESSAGE);
    expect(sendClicks).toHaveBeenCalledTimes(1);
    // Consumed: the bulletin rode the message out.
    expect(queuedChipCount()).toBe(0);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("aborts the send, loudly, when the bulletin route fails", async () => {
    // One representative failure, not the taxonomy. What is asserted here is
    // that keel is wired to a chain that ABORTS: without the bulletin the model
    // invents POL-118 and its required action, and `POST /briefs` files the
    // brief anyway — the beat's proof, manufactured.
    mountComposer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );

    const sent = await sendBulletinMessage();

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

describe("attachBulletinByHand: the paperclip fallback", () => {
  it("attaches the bulletin and sends nothing", async () => {
    mountComposer({ encodeMs: 10 });
    const fetchSpy = vi.fn(okResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(attachBulletinByHand()).resolves.toBe(true);

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

    await expect(attachBulletinByHand()).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
    // It never intended to send, so it must not claim a send failed.
    expect(surfacedText()).not.toContain("nothing was sent");
  });
});
