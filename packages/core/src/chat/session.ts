import type { AbstractAgent } from "@ag-ui/client";
import { randomUUID } from "@copilotkit/shared";
import type { Attachment } from "@copilotkit/shared";
import type { CopilotKitCore } from "../core/core";
import { isRunCompletionAware } from "../intelligence-agent";
import type { Suggestion } from "../types";
import type { ɵAttachmentQueue } from "./attachment-queue";
import { ɵbuildUserMessageContent } from "./attachment-queue";
import type { CopilotChatLabels } from "./labels";
import type {
  ɵThreadSelection,
  ɵThreadSwitchCoordinator,
} from "./thread-switch";
import type { TranscriptionCore } from "./transcription";
import {
  TranscriptionError,
  ɵtranscribeAudio,
  ɵtranscriptionErrorMessageKey,
} from "./transcription";

/** How long a chat notice (a failed transcription, a blocked send) stays on screen. */
export const ɵTRANSCRIPTION_ERROR_TIMEOUT_MS = 5000;

/**
 * A message the chat shows over the input for a few seconds: a chat label, or
 * text no label covers.
 */
export type ɵChatNotice =
  | { labelKey: keyof CopilotChatLabels }
  | { text: string };

/** The text of a notice in the chat's labels. */
export function ɵresolveChatNotice(
  notice: ɵChatNotice,
  labels: CopilotChatLabels,
) {
  return "labelKey" in notice ? labels[notice.labelKey] : notice.text;
}

/** The notice for a failed transcription: its label, or its own message when no label fits. */
export function ɵtranscriptionErrorNotice(error: unknown): ɵChatNotice {
  if (!(error instanceof TranscriptionError)) {
    return { labelKey: "transcriptionErrorGenericText" };
  }
  const labelKey = ɵtranscriptionErrorMessageKey(error.info);
  return labelKey ? { labelKey } : { text: error.info.message };
}

/**
 * The input text after a transcription: the transcript appended to what was
 * typed, with one space between. A blank transcript leaves the text as it
 * was.
 */
export function ɵappendTranscript(previous: string, transcript: string) {
  const text = transcript.trim();
  if (!text) return previous;
  const trimmedPrevious = previous.trim();
  return trimmedPrevious ? `${trimmedPrevious} ${text}` : text;
}

/**
 * Stops the agent's run through core, or aborts it directly when core's stop
 * throws. Logs both failures; never throws.
 */
export function ɵstopAgentWithFallback(
  core: Pick<CopilotKitCore, "stopAgent">,
  agent: AbstractAgent,
) {
  try {
    core.stopAgent({ agent });
  } catch (error) {
    console.error("CopilotChat: stopAgent failed", error);
    try {
      agent.abortRun();
    } catch (abortError) {
      console.error("CopilotChat: abortRun fallback failed", abortError);
    }
  }
}

/**
 * A new user message with the text and the ready attachments.
 *
 * @param text - What the user typed, sent as typed.
 * @param attachments - Ready attachments, from {@link ɵAttachmentQueue.consumeReady}.
 */
export function ɵbuildUserMessage(
  text: string,
  attachments: readonly Attachment[] = [],
) {
  return {
    id: randomUUID(),
    role: "user" as const,
    content: ɵbuildUserMessageContent(text, attachments),
  };
}

/**
 * Waits for the run in flight on `agent` to finish, so a new message does not
 * pre-empt it (#5195: an interrupt resume aborted mid-flight leaves the graph
 * paused). Agents that expose no completion promise return at once. A
 * rejected run is logged and does not block.
 */
export async function ɵwaitForActiveRun(agent: AbstractAgent) {
  // Widen to `unknown` before the guard: narrowing `AbstractAgent` directly
  // would intersect with its private `activeRunCompletionPromise` and collapse
  // the type to `never`.
  const candidate: unknown = agent;
  const completion = isRunCompletionAware(candidate)
    ? candidate.activeRunCompletionPromise
    : undefined;
  if (!agent.isRunning || !completion) return;
  try {
    await completion;
  } catch (error) {
    console.error(
      "CopilotChat: in-flight run rejected while queuing send",
      error,
    );
  }
}

/** Per-run hooks a framework adds, such as React's Intelligence run-activity tracking. */
export interface ɵChatRunScope {
  /** The run id to start the run with. */
  runId?: string;
  /** Called once the run has settled, whether it succeeded or failed. */
  settle?: () => void;
}

/** What {@link ɵcreateChatSubmitter} works with. */
export interface ɵChatSubmitterOptions {
  /** The CopilotKit core that runs, stops and transcribes. */
  core: Pick<CopilotKitCore, "runAgent" | "stopAgent"> & TranscriptionCore;
  /** The chat's agent now. `undefined` while none is available. */
  getAgent: () => AbstractAgent | undefined;
  /** The chat's input text. Cleared on send, restored when a send is blocked. */
  input: { get: () => string; set: (value: string) => void };
  /**
   * The chat's attachments: a {@link ɵAttachmentQueue}, or a framework hook
   * with the same two methods. A send waits for no upload and takes the ready
   * attachments.
   */
  attachments?: Pick<ɵAttachmentQueue, "isUploading" | "consumeReady">;
  /**
   * The chat's thread coordinator. A send waits for the thread's connection
   * and is dropped when the user switches threads while it waits.
   */
  threads?: ɵThreadSwitchCoordinator;
  /** Called before each run; returns the run id and a settle hook. */
  prepareRun?: () => ɵChatRunScope | undefined;
}

/** What a chat submitter shows: the current notice and whether a recording is being transcribed. */
export interface ɵChatSubmitterSnapshot {
  notice: ɵChatNotice | null;
  isTranscribing: boolean;
}

/** Sends wait for this scope to stay current; switching it drops them. */
type SubmissionScope =
  | { selection: ɵThreadSelection }
  | { agent: AbstractAgent; threadId: string | undefined };

/**
 * The send side of a chat: typed messages, suggestions, stop, and voice
 * transcription. Owns the rules all three frameworks share:
 *
 * - A send waits for the thread's connection and for the run in flight, in
 *   order, so a new message never pre-empts a run (#5195).
 * - Blank text, and a send while an attachment uploads, go nowhere. A blocked
 *   send shows the `chatAttachmentsUploadingText` notice and puts the typed
 *   text back.
 * - A suggestion still loading cannot be picked.
 * - A failed transcription shows a notice for
 *   {@link ɵTRANSCRIPTION_ERROR_TIMEOUT_MS}.
 */
export class ɵChatSubmitter {
  private snapshot: ɵChatSubmitterSnapshot = {
    notice: null,
    isTranscribing: false,
  };
  private readonly listeners = new Set<() => void>();
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private queue: { scope: SubmissionScope; tail: Promise<void> } | undefined;
  private disposed = false;

  constructor(private readonly options: ɵChatSubmitterOptions) {}

  /** The current notice and transcription state. Keeps its identity until either changes. */
  getSnapshot() {
    return this.snapshot;
  }

  /** Calls `listener` after every snapshot change. Returns the unsubscribe. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Sends `value` as a user message with the ready attachments and runs the
   * agent. Clears the input at once; puts the text back when the send is
   * blocked after waiting. Resolves when the run has settled.
   */
  async submit(value: string) {
    if (this.disposed || !value.trim()) return;
    const { attachments, input } = this.options;
    if (attachments?.isUploading()) {
      console.error(
        "[CopilotKit] Cannot send while attachments are uploading (pre-await guard)",
      );
      this.showNotice({ labelKey: "chatAttachmentsUploadingText" });
      return;
    }

    // Clear at once so the composer reflects the accepted send, even though
    // the dispatch may wait behind a run in flight.
    input.set("");

    await this.enqueue(async (agent) => {
      const turn = await this.waitForTurn(agent);
      if (turn !== "ready") {
        if (turn === "failed") input.set(value);
        return;
      }
      // An upload can start while the send waits; consuming now would send an
      // attachment with an incomplete source.
      if (attachments?.isUploading()) {
        console.error(
          "[CopilotKit] Cannot send while attachments are uploading (post-await re-check)",
        );
        this.showNotice({ labelKey: "chatAttachmentsUploadingText" });
        input.set(value);
        return;
      }
      agent.addMessage(
        ɵbuildUserMessage(value, attachments?.consumeReady() ?? []),
      );
      await this.run(agent, "CopilotChat: runAgent failed");
    });
  }

  /**
   * Sends a suggestion's message and runs the agent, after the run in flight.
   * A suggestion still loading, or with a blank message, is ignored.
   */
  async selectSuggestion(
    suggestion: Pick<Suggestion, "message" | "isLoading">,
  ) {
    const isPickable =
      !suggestion.isLoading && suggestion.message.trim() !== "";
    if (this.disposed || !isPickable) return;
    await this.enqueue(async (agent) => {
      if ((await this.waitForTurn(agent)) !== "ready") return;
      agent.addMessage(ɵbuildUserMessage(suggestion.message));
      await this.run(
        agent,
        "CopilotChat: runAgent failed after selecting suggestion",
      );
    });
  }

  /** Stops the agent's run. See {@link ɵstopAgentWithFallback}. */
  stop() {
    const agent = this.options.getAgent();
    if (agent) ɵstopAgentWithFallback(this.options.core, agent);
  }

  /**
   * Transcribes a recording and appends the text to the input. A failure
   * shows a notice instead.
   */
  async transcribe(audio: Blob) {
    this.setSnapshot({ isTranscribing: true });
    this.showNotice(null);
    try {
      const result = await ɵtranscribeAudio(this.options.core, audio);
      if (this.disposed) return;
      const { input } = this.options;
      input.set(ɵappendTranscript(input.get(), result.text));
    } catch (error) {
      console.error("CopilotChat: Transcription failed", error);
      this.showNotice(ɵtranscriptionErrorNotice(error));
    } finally {
      this.setSnapshot({ isTranscribing: false });
    }
  }

  /**
   * Shows `notice` for {@link ɵTRANSCRIPTION_ERROR_TIMEOUT_MS}, replacing the
   * current one. `null` clears it.
   */
  showNotice(notice: ɵChatNotice | null) {
    clearTimeout(this.noticeTimer);
    this.noticeTimer = undefined;
    if (this.disposed) return;
    this.setSnapshot({ notice });
    if (notice === null) return;
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = undefined;
      this.setSnapshot({ notice: null });
    }, ɵTRANSCRIPTION_ERROR_TIMEOUT_MS);
  }

  /** Stops the notice timer and drops queued sends. */
  dispose() {
    this.disposed = true;
    clearTimeout(this.noticeTimer);
    this.listeners.clear();
  }

  private setSnapshot(patch: Partial<ɵChatSubmitterSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    const isUnchanged =
      next.notice === this.snapshot.notice &&
      next.isTranscribing === this.snapshot.isTranscribing;
    if (isUnchanged || this.disposed) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private currentScope(agent: AbstractAgent): SubmissionScope {
    const selection = this.options.threads?.current;
    return selection ? { selection } : { agent, threadId: agent.threadId };
  }

  private isScopeCurrent(scope: SubmissionScope) {
    if (this.disposed) return false;
    if ("selection" in scope) return scope.selection.isCurrent;
    const agent = this.options.getAgent();
    return agent === scope.agent && agent.threadId === scope.threadId;
  }

  private isSameScope(a: SubmissionScope, b: SubmissionScope) {
    if ("selection" in a && "selection" in b)
      return a.selection === b.selection;
    if ("agent" in a && "agent" in b) {
      return a.agent === b.agent && a.threadId === b.threadId;
    }
    return false;
  }

  // Sends run one after another per thread; a thread switch starts a fresh
  // queue and drops what was waiting on the old one.
  private enqueue(send: (agent: AbstractAgent) => Promise<void>) {
    const agent = this.options.getAgent();
    if (!agent) {
      console.error("[CopilotKit] Cannot send message: no agent available");
      return Promise.resolve();
    }
    const scope = this.currentScope(agent);
    const previous =
      this.queue && this.isSameScope(this.queue.scope, scope)
        ? this.queue.tail
        : Promise.resolve();
    const tail = previous
      .then(async () => {
        if (this.isScopeCurrent(scope)) await send(agent);
      })
      .catch((error: unknown) => {
        console.error("CopilotChat: queued submission failed", error);
      });
    this.queue = { scope, tail };
    return tail;
  }

  // Waits for the thread's connection, then the run in flight. "failed" when
  // the thread did not load, "stale" when the user moved on meanwhile.
  private async waitForTurn(agent: AbstractAgent) {
    const { threads } = this.options;
    const selection = threads?.current;
    if (threads && selection) {
      const connection = await threads.waitForConnection(selection);
      if (connection === "failed") {
        this.showNotice({ labelKey: "threadLoadErrorText" });
      }
      if (connection !== "ready") return connection;
    }
    const scope = this.currentScope(agent);
    await ɵwaitForActiveRun(agent);
    return this.isScopeCurrent(scope) ? "ready" : "stale";
  }

  private async run(agent: AbstractAgent, failureMessage: string) {
    const scope = this.options.prepareRun?.();
    try {
      await this.options.core.runAgent({
        agent,
        ...(scope?.runId !== undefined ? { runId: scope.runId } : {}),
      });
    } catch (error) {
      console.error(failureMessage, error);
    } finally {
      scope?.settle?.();
    }
  }
}

/**
 * Creates the send side of a chat. See {@link ɵChatSubmitter}.
 *
 * @example
 * ```ts
 * const submitter = ɵcreateChatSubmitter({
 *   core,
 *   getAgent: () => agent,
 *   input: { get: () => text, set: (value) => (text = value) },
 *   attachments: queue,
 *   threads,
 * });
 * await submitter.submit("Hello");
 * ```
 */
export function ɵcreateChatSubmitter(options: ɵChatSubmitterOptions) {
  return new ɵChatSubmitter(options);
}
