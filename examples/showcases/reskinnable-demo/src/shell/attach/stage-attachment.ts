/**
 * BEAT 3d — stage a generated document into the chat composer's built-in hidden
 * file input, so CopilotKit's standard attachment flow picks it up: the document
 * appears as a real attachment chip and rides the next message to the model.
 *
 * SHELL-OWNED, because every skin that runs beat 3d needs the identical chain
 * and only three values differ: the document's `url`, its `filename`, and the
 * message the pill sends. Everything else — the ordering, the bounded waits, the
 * framework selectors, the abort rule, the dual reporting — is a property of
 * CopilotKit's composer, not of any one domain.
 *
 * Used by a skin's chat-header paperclip AND its suggestion pill, so both take
 * the identical blessed path (the one that correctly consumes attachments on
 * submit). The pill needs it because the framework's suggestion path DROPS
 * attachments — a pill that must carry a file has to be intercepted in
 * `onSuggestionSelect` and driven through the real composer instead.
 *
 * The paperclip exists as a manual fallback: if the pill path misbehaves on
 * stage, the presenter can still attach the file by hand and carry on.
 *
 * ── WHY THIS WHOLE CHAIN IS FAIL-LOUD ───────────────────────────────────────
 * Beat 3d's entire claim is that a REAL document was ingested into a durable
 * artifact. If the prompt ("read the attached sheet and file the plan") is sent
 * with no attachment, the model invents the contents and the artifact is still
 * filed — so the demo LOOKS fine while proving the exact opposite of its point.
 * That is the most damaging failure available here, and it is invisible.
 *
 * ── AND WHY IT VERIFIES RATHER THAN ASSUMES ─────────────────────────────────
 * Reporting a failure loudly is worthless if the failure is never DETECTED. This
 * module drives someone else's React component through the DOM, so every step is
 * a request whose effect has to be observed, never assumed:
 *
 *   - Dispatching `change` on the hidden input does not mean the file was taken.
 *     `useAttachments.processFiles` silently DROPS files that fail the `accept`
 *     filter or the size cap (`use-attachments.tsx:76-99`) and this app wires no
 *     `onUploadFailed`, so a rejection is otherwise invisible.
 *   - An accepted file is not a SENDABLE file. It lands as `status:"uploading"`
 *     and only becomes `"ready"` after base64 encoding resolves
 *     (`use-attachments.tsx:103-144`). `CopilotChat.onSubmitInput` REFUSES to
 *     send while anything is uploading (`CopilotChat.tsx:649-657, 677-686`), and
 *     `consumeAttachments` only ever hands over `ready` files
 *     (`use-attachments.tsx:245-253`). A fixed sleep races that encode; on a slow
 *     machine or a bigger document it loses.
 *   - Clicking the send button does not mean a message was sent. The same button
 *     is the STOP button while a run is in flight, and a click then CANCELS the
 *     run (`CopilotChatInput.tsx:520-530, 540-547`).
 *
 * So every step below obeys four rules:
 *   1. The prompt is NEVER sent unless the document is verifiably staged,
 *      accepted AND finished encoding.
 *   2. Waiting is CONDITION-based with a bounded budget, never a fixed sleep. An
 *      expired budget is a failure, not a green light.
 *   3. Every failure names ITSELF — a distinct `cause` and a distinct sentence,
 *      because "retry" and "restart the dev server" are different instructions.
 *      Reported via `console.error` for the log AND `window.alert` so a presenter
 *      mid-demo actually sees it (the pattern the skins' reset button uses).
 *   4. No promise is launched and forgotten, and no path resolves `true` without
 *      a confirmed attachment AND a confirmed send.
 */

/**
 * The only per-skin values in the whole chain. A skin passes the route that
 * generates its document and the name the composer should show for it.
 */
export interface AttachmentDocument {
  /** The route that serves the PDF, e.g. `/api/commerce/v1/price-sheet`. */
  url: string;
  /** The filename the composer chip prints, e.g. `price-sheet-acme.pdf`. */
  filename: string;
}

/**
 * The composer elements this beat drives. They are framework-owned test ids, so
 * a CopilotKit upgrade can rename them out from under us — which is precisely
 * why their absence has to be reported rather than returned as a silent no-op.
 */
export const ATTACHMENT_FILE_INPUT_SELECTOR =
  'input[type="file"][accept*="pdf"]';
export const CHAT_TEXTAREA_SELECTOR =
  'textarea[data-testid="copilot-chat-textarea"]';
export const CHAT_SEND_BUTTON_SELECTOR =
  'button[data-testid="copilot-send-button"]';

/**
 * The attachment QUEUE — the only place the framework's attachment state machine
 * is observable from outside React. `CopilotChatView` mounts it only when the
 * queue is non-empty (`CopilotChatView.tsx:356`) and it carries this test id
 * (`CopilotChatAttachmentQueue.tsx:25`), so:
 *
 *   - a new chip appearing  ⇒ `processFiles` ACCEPTED the file (it pushed the
 *     `uploading` placeholder, `use-attachments.tsx:103-112`);
 *   - no chip appearing     ⇒ it was rejected by `accept`/`maxSize` and dropped.
 *
 * Each chip is the PARENT of a "Remove attachment" button
 * (`CopilotChatAttachmentQueue.tsx:45-54`), which is the most stable way to count
 * them — the chip div itself carries only utility classes.
 */
export const ATTACHMENT_QUEUE_SELECTOR =
  '[data-testid="copilot-attachment-queue"]';
export const ATTACHMENT_CHIP_SELECTOR =
  'button[aria-label="Remove attachment"]';

/**
 * The framework exposes NO status attribute on an attachment chip — nothing like
 * `data-status="ready"`. What it does do is render an EMPTY body while a chip is
 * `uploading` (`CopilotChatAttachmentQueue.tsx:43,75-77`) and only print the
 * filename once the chip is `ready` and `DocumentPreview` takes over
 * (`CopilotChatAttachmentQueue.tsx:336-366, esp. 357-359`).
 *
 * So "the queue contains a chip whose text includes our filename" is a DERIVED
 * proxy for `status === "ready"`. It is the best signal available, and being a
 * proxy is exactly why the wait around it is bounded and fails CLOSED: if the
 * framework stops printing filenames, this beat aborts loudly instead of sending
 * an unattached prompt.
 */
function attachmentChips(): HTMLElement[] {
  const queue = document.querySelector(ATTACHMENT_QUEUE_SELECTOR);
  if (!queue) return [];
  return Array.from(
    queue.querySelectorAll<HTMLElement>(ATTACHMENT_CHIP_SELECTOR),
  )
    .map((button) => button.parentElement)
    .filter((chip): chip is HTMLElement => chip !== null);
}

/** Chips whose text names our document — i.e. that reached `ready`. See above. */
function readyChipCount(filename: string): number {
  return attachmentChips().filter((chip) =>
    (chip.textContent ?? "").includes(filename),
  ).length;
}

/**
 * SEND state vs STOP state, derived from the framework rather than guessed.
 *
 * `CopilotChatInput` renders ONE button for both roles
 * (`CopilotChatInput.tsx:540-547`):
 *
 *   children: isProcessing && canStop ? <Square/> : undefined
 *   disabled: isProcessing ? !canStop : !canSend
 *
 * and `SendButton` falls back to `<ArrowUp/>` when `children` is undefined
 * (`CopilotChatInput.tsx:1158`). lucide-react stamps each mark with
 * `lucide-<kebab-name>` (`lucide-react@0.447.0`, `createLucideIcon`), so the mark
 * inside the button is a faithful read of that ternary. Enumerating the four
 * states:
 *
 *   | isProcessing | canStop | canSend | mark     | disabled |
 *   | no           | –       | yes     | arrow-up | no       | ← the only sendable one
 *   | no           | –       | no      | arrow-up | yes      |
 *   | yes          | yes     | –       | square   | no       | ← a click CANCELS the run
 *   | yes          | no      | –       | arrow-up | yes      |
 *
 * Hence: an enabled button carrying the arrow-up mark is sendable, and nothing
 * else is. Requiring the arrow-up mark POSITIVELY (rather than merely checking
 * the square is absent) is what makes a future icon rename abort the beat instead
 * of clicking a button whose role we can no longer identify.
 */
export const SEND_MARK_SELECTOR = ".lucide-arrow-up";
export const STOP_MARK_SELECTOR = ".lucide-square";

type SendButtonState = "sendable" | "stop" | "disabled" | "unrecognized";

function sendButtonState(button: HTMLButtonElement): SendButtonState {
  // Checked FIRST: a stop button is enabled, so a `disabled` test would miss it.
  if (button.querySelector(STOP_MARK_SELECTOR)) return "stop";
  if (button.disabled) return "disabled";
  if (!button.querySelector(SEND_MARK_SELECTOR)) return "unrecognized";
  return "sendable";
}

/**
 * How long each observation is allowed to take. Exposed (and injectable) so the
 * budgets are readable in one place and so tests can exercise every expiry
 * branch without spending the real budget on each.
 */
export interface Beat3dTimings {
  /** Composer ACCEPTS the staged file — a chip appears in the queue. */
  acceptMs: number;
  /** Base64 encoding finishes — that chip reaches `ready`. */
  readyMs: number;
  /** The send button reaches an enabled SEND state after the prompt is typed. */
  sendableMs: number;
  /** The click CONSUMES the attachment — the chip leaves the queue. */
  consumedMs: number;
  /** Poll interval for all of the above. */
  pollMs: number;
}

export const DEFAULT_BEAT_3D_TIMINGS: Beat3dTimings = {
  acceptMs: 3_000,
  readyMs: 10_000,
  sendableMs: 2_000,
  consumedMs: 10_000,
  pollMs: 25,
};

/** Why a beat-3d attempt stopped. One value per distinct presenter instruction. */
export type AttachmentFailureCause =
  /** The fetch itself threw — network layer, dev server down. */
  | "fetch-failed"
  /** The route answered non-2xx. */
  | "http-error"
  /** 2xx with a zero-length body. */
  | "empty-body"
  /** 2xx whose bytes are not a PDF (typically an HTML error page). */
  | "not-a-pdf"
  /** The composer's hidden file input is not in the DOM. */
  | "no-file-input"
  /** Writing the file onto the input threw (DataTransfer/File unavailable). */
  | "staging-threw"
  /** The composer never took the file — `accept`/`maxSize` dropped it. */
  | "rejected"
  /** The file was accepted but never finished encoding within budget. */
  | "encode-timeout"
  /** The textarea or the send button is not in the DOM. */
  | "no-composer"
  /** The React value setter is gone, or the write did not land. */
  | "stale-value"
  /** The send button stayed disabled. */
  | "send-disabled"
  /** The button is a STOP button — clicking would cancel a run, not send. */
  | "send-stop-state"
  /** The button carries neither known mark; its role cannot be identified. */
  | "send-unrecognized"
  /** The click did not consume the attachment within budget. */
  | "send-unconfirmed"
  /** Anything that escaped a narrower handler. */
  | "unexpected";

/**
 * The outcome of a staging attempt.
 *
 * WHY NOT A BOOLEAN. A bare `boolean` collapsed every distinct failure into one
 * indistinguishable `false`, so no caller could tell the presenter what actually
 * broke. Carrying a machine-readable `cause` AND a human `detail` is what makes
 * "say something USEFUL on every path" expressible — and what lets the tests
 * pin each mode without matching on prose.
 */
export type AttachmentStaging =
  | { staged: true }
  | { staged: false; cause: AttachmentFailureCause; detail: string };

function fail(
  cause: AttachmentFailureCause,
  detail: string,
): { staged: false; cause: AttachmentFailureCause; detail: string } {
  return { staged: false, cause, detail };
}

/**
 * The single reporting surface for this beat. A `console.error` alone is not
 * enough: the failure it describes happens while someone is standing in front of
 * an audience, and nobody opens devtools mid-demo. The alert is the point — it
 * stops the presenter from narrating a plan built on invented numbers.
 *
 * The `cause` is carried into the LOG LINE only, tagged as `[attach:<cause>]`.
 * The presenter reads the alert and does not need the machine token; a developer
 * reading the console — or a test driving the send path, where the entry point
 * returns a bare boolean and the log is the only place the cause is observable —
 * does.
 *
 * The lede is overridable for the two cases where the default would be wrong: a
 * paperclip failure (nothing was GOING to be sent), and a send we clicked but
 * could not confirm (telling a presenter nothing was sent when a message may be
 * in flight sends them into a double-send).
 */
export const NOTHING_SENT_LEDE =
  "Could not attach the document — nothing was sent.";

export function reportAttachmentFailure(
  cause: AttachmentFailureCause,
  detail: string,
  lede: string = NOTHING_SENT_LEDE,
): void {
  const message = `${lede} ${detail}`;
  console.error(`[attach:${cause}] ${message}`);
  if (typeof window !== "undefined") window.alert(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `predicate` until it holds or the budget expires. Resolves whether it
 * held — an expiry is a plain `false`, never an assumption that it "probably"
 * happened by now. This replaces the fixed 500 ms sleep that used to race the
 * framework's base64 encode: the defect was the racing, not the duration.
 */
async function waitUntil(
  predicate: () => boolean,
  budgetMs: number,
  pollMs: number,
): Promise<boolean> {
  if (predicate()) return true;
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    if (predicate()) return true;
  }
  return predicate();
}

/**
 * A PDF really is a PDF, checked on the BYTES rather than trusted from the URL.
 *
 * The route is a Next handler: a thrown error, a stray redirect or a dev-server
 * error overlay can all answer 200 with HTML. Forcing `type:"application/pdf"`
 * onto the File (below) would then smuggle that HTML past the composer's accept
 * filter, and the model would be handed a web page to read numbers from. The
 * header is searched rather than required at offset 0 because real-world PDFs
 * tolerate leading bytes; an HTML page still has no `%PDF` in its first KB.
 */
function looksLikePdf(bytes: Uint8Array): boolean {
  const header = "%PDF";
  const lead = bytes.subarray(0, 1024);
  for (let i = 0; i + header.length <= lead.length; i++) {
    let hit = true;
    for (let j = 0; j < header.length; j++) {
      if (lead[i + j] !== header.charCodeAt(j)) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/** The first bytes as text, for a failure message that identifies the culprit. */
function describeBody(bytes: Uint8Array): string {
  const head = Array.from(bytes.subarray(0, 48))
    .map((byte) =>
      byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".",
    )
    .join("");
  return `${bytes.length} bytes starting "${head}"`;
}

/**
 * Fetch the document, verify it IS one, hand it to the composer, and confirm the
 * composer both accepted it and finished encoding it.
 *
 * Resolves `{ staged: true }` only when the attachment is present in the queue
 * AND `ready` — i.e. only when `consumeAttachments` would actually hand it to the
 * next message. Every other outcome names its own cause. It does NOT send; that
 * is `sendMessageWithAttachment`'s job.
 */
export async function stageAttachment(
  doc: AttachmentDocument,
  timings: Beat3dTimings = DEFAULT_BEAT_3D_TIMINGS,
): Promise<AttachmentStaging> {
  // ── 1. the document ───────────────────────────────────────────────────────
  // Its own try, so a `File`/`DataTransfer` failure downstream can never be
  // reported as "the fetch threw" — which is what a single file-wide catch
  // used to do, sending a presenter to check a healthy network.
  // `<ArrayBuffer>` rather than a bare `Uint8Array`: since TS 5.7 the default
  // parameter is `ArrayBufferLike`, which includes `SharedArrayBuffer` and is
  // therefore not a valid `BlobPart` for the `new File([...])` below.
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const res = await fetch(doc.url);
    // A non-2xx is the SAME failure as a thrown fetch and has to be as loud, or
    // beat 3d fails invisibly.
    if (!res.ok) {
      return fail(
        "http-error",
        `${doc.url} answered HTTP ${res.status}. See the server logs.`,
      );
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    // Logged HERE in addition to the caller's report because only this frame
    // still holds the Error object, and its stack is what identifies a fetch
    // that died in the network layer. The string `detail` cannot carry it.
    console.error(`Could not fetch ${doc.filename}`, err);
    return fail("fetch-failed", `Fetching ${doc.url} threw: ${errorText(err)}`);
  }

  if (bytes.length === 0) {
    return fail(
      "empty-body",
      `${doc.url} answered 200 with an EMPTY body, so there is no document to attach.`,
    );
  }
  if (!looksLikePdf(bytes)) {
    return fail(
      "not-a-pdf",
      `${doc.url} answered 200 but the body is not a PDF (${describeBody(bytes)}) — probably an error page. Restart the dev server and check the route.`,
    );
  }

  // ── 2. hand it to the composer ────────────────────────────────────────────
  const input = document.querySelector<HTMLInputElement>(
    ATTACHMENT_FILE_INPUT_SELECTOR,
  );
  // This used to be a bare `return false` — the one failure mode in the chain
  // with no log at all. It fires when the framework's composer changes its
  // hidden input, i.e. on a dependency upgrade, which is exactly the class of
  // breakage that must not be discoverable only by watching the model lie.
  if (!input) {
    return fail(
      "no-file-input",
      `The composer's hidden file input (${ATTACHMENT_FILE_INPUT_SELECTOR}) is not in the DOM.`,
    );
  }

  const chipsBefore = attachmentChips().length;
  const readyBefore = readyChipCount(doc.filename);

  try {
    const file = new File([bytes], doc.filename, {
      type: "application/pdf",
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    // A native, BUBBLING change event, so CopilotChat's own onChange handler
    // runs and enqueues the attachment exactly as a manual pick would. A
    // React-synthetic dispatch would not reach it.
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (err) {
    console.error(`Could not stage ${doc.filename} into the composer`, err);
    return fail(
      "staging-threw",
      `Writing the file onto the composer's hidden input threw: ${errorText(err)}`,
    );
  }

  // ── 3. did the composer TAKE it? ──────────────────────────────────────────
  // Dispatching `change` is a request, not an outcome. `processFiles` drops a
  // file that fails `accept` or `maxSize` and calls an `onUploadFailed` this app
  // does not wire, so a rejection leaves NO trace except this chip never
  // appearing (`use-attachments.tsx:76-99`).
  const accepted = await waitUntil(
    () => attachmentChips().length > chipsBefore,
    timings.acceptMs,
    timings.pollMs,
  );
  if (!accepted) {
    return fail(
      "rejected",
      `The composer never queued ${doc.filename} — it was rejected by the attachment filter (accept/maxSize) or the queue is not rendering. No attachment chip appeared within ${timings.acceptMs}ms.`,
    );
  }

  // ── 4. has it finished ENCODING? ──────────────────────────────────────────
  // `consumeAttachments` hands over only `ready` files and `onSubmitInput`
  // refuses to send while anything is `uploading`, so sending now would either
  // be blocked outright or strip the document and strand it on the next message.
  const ready = await waitUntil(
    () => readyChipCount(doc.filename) > readyBefore,
    timings.readyMs,
    timings.pollMs,
  );
  if (!ready) {
    return fail(
      "encode-timeout",
      `${doc.filename} was queued but never finished encoding within ${timings.readyMs}ms, so the composer would refuse to send it. Wait a moment and retry the paperclip.`,
    );
  }

  return { staged: true };
}

/**
 * Set a React-controlled textarea's value so its onChange actually fires, and
 * report whether the write LANDED.
 *
 * The setter lookup used to be `setter?.call(...)`, which optional-chained away
 * the only thing that can go wrong here and then dispatched an `input` event
 * carrying the STALE value — React re-rendered the empty textarea, `canSend`
 * stayed false, and the caller clicked a disabled button while resolving `true`.
 */
function setTextareaValue(el: HTMLTextAreaElement, value: string): boolean {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setter) return false;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return el.value === value;
}

/**
 * The chat header's paperclip — the presenter's manual fallback.
 *
 * Returns whether the document is now attached AND ready to ride the next
 * message. It used to be launched as `void stagePriceSheetAttachment()`,
 * discarding both the boolean and any rejection, so the fallback for a broken
 * pill could itself fail with nothing anywhere. Every failure now reports before
 * this resolves `false`.
 */
export async function attachByHand(
  doc: AttachmentDocument,
  timings: Beat3dTimings = DEFAULT_BEAT_3D_TIMINGS,
): Promise<boolean> {
  try {
    const result = await stageAttachment(doc, timings);
    if (result.staged) return true;
    // No "nothing was sent" here: the paperclip never intended to send, and a
    // lede that mentions a send the presenter did not ask for reads as a second,
    // phantom failure.
    reportAttachmentFailure(
      result.cause,
      result.detail,
      "Could not attach the document.",
    );
    return false;
  } catch (err) {
    reportAttachmentFailure("unexpected", unexpected(err));
    return false;
  }
}

/**
 * BEAT 3d's pill: stage the file into the composer's hidden input, type the
 * prompt into the real textarea, click the real send button. That is the only
 * path that consumes an attachment on submit; the framework's suggestion path
 * drops it.
 *
 * ORDER IS LOAD-BEARING. The composer is located BEFORE anything is staged, so a
 * renamed test id aborts the beat while it is still a no-op — rather than after
 * an attachment chip has been pushed into a composer we then discover we cannot
 * drive, leaving the document stranded on the next thing the presenter types.
 *
 * Resolves `true` only when the prompt was actually sent WITH the document —
 * confirmed by the attachment leaving the queue, which only `consumeAttachments`
 * does and only as part of dispatching the message. Every `false` has already
 * been reported to the presenter.
 */
export async function sendMessageWithAttachment(
  doc: AttachmentDocument,
  message: string,
  timings: Beat3dTimings = DEFAULT_BEAT_3D_TIMINGS,
): Promise<boolean> {
  try {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      CHAT_TEXTAREA_SELECTOR,
    );
    const sendButton = document.querySelector<HTMLButtonElement>(
      CHAT_SEND_BUTTON_SELECTOR,
    );
    if (!textarea || !sendButton) {
      reportAttachmentFailure(
        "no-composer",
        `The chat composer was not found (${CHAT_TEXTAREA_SELECTOR} / ${CHAT_SEND_BUTTON_SELECTOR}). Attach the document with the paperclip and send the prompt by hand.`,
      );
      return false;
    }

    const staging = await stageAttachment(doc, timings);
    // THE GUARD THIS WHOLE FILE EXISTS FOR. Sending the prompt without the
    // document makes the model invent its contents and file a plausible-looking
    // artifact off them, which is worse than not running the beat at all.
    if (!staging.staged) {
      reportAttachmentFailure(staging.cause, staging.detail);
      return false;
    }

    // The prompt has to be in the composer BEFORE the send button can be
    // sendable at all: `canSend` requires a non-empty trimmed value
    // (`CopilotChatInput.tsx:517`). That dependency is also what turns the wait
    // below into a check on this write.
    if (!setTextareaValue(textarea, message)) {
      reportAttachmentFailure(
        "stale-value",
        "The prompt could not be written into the composer (React's textarea value setter is unavailable, or the write did not stick), so the document is attached but nothing was sent. Type the prompt and press send.",
      );
      return false;
    }

    // React has to re-render before `canSend` flips, so this is a wait, not an
    // assertion. An expiry is classified rather than collapsed: a STOP button, a
    // disabled button and an unidentifiable button need three different actions
    // from the presenter.
    const sendable = await waitUntil(
      () => sendButtonState(sendButton) === "sendable",
      timings.sendableMs,
      timings.pollMs,
    );
    if (!sendable) {
      const blocked = sendBlocked(sendButtonState(sendButton));
      reportAttachmentFailure(blocked.cause, blocked.detail);
      return false;
    }

    const readyBeforeSend = readyChipCount(doc.filename);
    sendButton.click();

    // Clicking is a request too. `onSubmitInput` calls `consumeAttachments`,
    // which is the ONLY thing that removes a `ready` chip from the queue
    // (`use-attachments.tsx:245-253`) and does so as part of building the
    // outgoing message (`CopilotChat.tsx:688-716`). So the chip leaving IS the
    // confirmation that the document went out attached.
    const consumed = await waitUntil(
      () => readyChipCount(doc.filename) < readyBeforeSend,
      timings.consumedMs,
      timings.pollMs,
    );
    if (!consumed) {
      // The one case where "nothing was sent" would be a LIE — the click landed
      // and a message may be in flight. Telling the presenter otherwise invites
      // a double send.
      reportAttachmentFailure(
        "send-unconfirmed",
        `The send button was clicked but ${doc.filename} never left the attachment queue within ${timings.consumedMs}ms, so it is unconfirmed whether the prompt went out WITH the document. Check the transcript before retrying.`,
        "Could not confirm the document was sent.",
      );
      return false;
    }

    return true;
  } catch (err) {
    reportAttachmentFailure("unexpected", unexpected(err));
    return false;
  }
}

function sendBlocked(state: SendButtonState): {
  cause: AttachmentFailureCause;
  detail: string;
} {
  switch (state) {
    case "stop":
      return {
        cause: "send-stop-state",
        detail:
          "The composer's send button is currently a STOP button — a run is already in flight, and clicking it would CANCEL that run instead of sending. Wait for the run to finish and retry the pill.",
      };
    case "disabled":
      return {
        cause: "send-disabled",
        detail:
          "The composer's send button stayed disabled — either it never registered the prompt text, or a run is in flight with no stop handler. The document is attached; press send by hand.",
      };
    case "unrecognized":
      return {
        cause: "send-unrecognized",
        detail: `The composer's send button carries neither the send (${SEND_MARK_SELECTOR}) nor the stop (${STOP_MARK_SELECTOR}) mark, so its role cannot be identified and clicking it is unsafe. The framework's icons changed — the document is attached; press send by hand.`,
      };
    case "sendable":
      // Only reachable if the button became sendable between the expiry and this
      // re-read. Naming it beats pretending the wait told us nothing. It shares
      // `send-disabled` because a cause is one PRESENTER INSTRUCTION, and the
      // instruction here is the same one: the document is attached, press send.
      return {
        cause: "send-disabled",
        detail:
          "The composer's send button only became sendable after the wait expired, so the prompt was not clicked. The document is attached; press send by hand.",
      };
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function unexpected(err: unknown): string {
  return `Unexpected error: ${errorText(err)}`;
}
