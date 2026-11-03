import {
  createAttachmentContent,
  exceedsMaxSize,
  formatFileSize,
  generateVideoThumbnail,
  getModalityFromMimeType,
  matchesAcceptFilter,
  randomUUID,
  readFileAsBase64,
} from "@copilotkit/shared";
import type {
  Attachment,
  AttachmentsConfig,
  InputContent,
} from "@copilotkit/shared";

/** The largest file the chat takes when `maxSize` is unset: 20 MB. */
const DEFAULT_MAX_SIZE = 20 * 1024 * 1024;

/**
 * How many uploads run at once when `maxConcurrentUploads` is unset. One,
 * because `onUpload` is a public callback an app may have written expecting
 * the previous file to have finished — concurrency is something the app asks
 * for.
 */
const DEFAULT_MAX_CONCURRENT_UPLOADS = 1;

/**
 * At least one upload at a time, whole files only. `NaN` or a non-number falls
 * back to the default, and `Infinity` means "no limit" — bounded in practice by
 * how many files are queued.
 */
function resolveMaxConcurrentUploads(configured: number | undefined) {
  if (typeof configured !== "number" || Number.isNaN(configured)) {
    return DEFAULT_MAX_CONCURRENT_UPLOADS;
  }
  return Math.max(1, Math.floor(configured));
}

/** One file waiting for, or holding, an upload slot. */
interface QueuedUpload {
  file: File;
  placeholder: Attachment;
  /** The config as it was when this file was picked, so a later config change can't retarget it. */
  config: AttachmentsConfig;
  /** Resolves the `processFiles` call that queued this file once the upload has settled. */
  settle: () => void;
}

/** One clipboard entry, as `ClipboardEvent.clipboardData.items` lists it. */
export interface ɵClipboardItem {
  kind: string;
  getAsFile(): File | null;
}

/**
 * The chat's attachment queue: validates picked, dropped or pasted files,
 * shows a placeholder per file, uploads them (through `onUpload`, or as
 * base64), and hands the ready ones to the next message.
 *
 * Framework-neutral: React reads it with `useSyncExternalStore`, Vue with a
 * `shallowRef`, Angular with a `signal`. The snapshot keeps its identity until
 * the list changes.
 *
 * @example
 * ```ts
 * const queue = new ɵAttachmentQueue(() => props.attachments);
 * const unsubscribe = queue.subscribe(() => render(queue.getSnapshot()));
 * await queue.processFiles(Array.from(input.files));
 * const ready = queue.consumeReady();
 * ```
 */
export class ɵAttachmentQueue {
  private attachments: Attachment[] = [];
  private readonly listeners = new Set<() => void>();
  // The upload queue is the chat's, not one `processFiles` call's, so a paste
  // landing while a drop is still uploading shares the same slots instead of
  // opening its own set.
  private readonly uploads: QueuedUpload[] = [];
  private activeWorkers = 0;
  private disposed = false;

  /**
   * @param getConfig - Reads the chat's current `attachments` config. Called on
   *   every action, so a changed config applies to the next file without
   *   recreating the queue.
   */
  constructor(
    private readonly getConfig: () => AttachmentsConfig | undefined,
  ) {}

  /** The attachments in the queue, uploading and ready, in pick order. */
  getSnapshot() {
    return this.attachments;
  }

  /** Calls `listener` after every change to the list. Returns the unsubscribe. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Whether any file in the queue is still uploading. A send waits for none. */
  isUploading() {
    return this.attachments.some((a) => a.status === "uploading");
  }

  /**
   * Validates `files` and uploads the accepted ones. Files of a type `accept`
   * excludes, or larger than `maxSize`, go to `onUploadFailed` and do not join
   * the queue. Every accepted file shows as `"uploading"` at once; at most
   * `maxConcurrentUploads` upload at the same time.
   *
   * Does nothing while attachments are disabled. Resolves once this call's own
   * files have settled; a failed upload reports through `onUploadFailed` and
   * never rejects.
   */
  async processFiles(files: readonly File[]) {
    const config = this.getConfig();
    if (!config?.enabled || this.disposed) return;

    const accept = config.accept ?? "*/*";
    const maxSize = config.maxSize ?? DEFAULT_MAX_SIZE;

    const queued: { file: File; placeholder: Attachment }[] = [];
    for (const file of files) {
      if (!matchesAcceptFilter(file, accept)) {
        config.onUploadFailed?.({
          reason: "invalid-type",
          file,
          message: `File "${file.name}" is not accepted. Supported types: ${accept}`,
        });
        continue;
      }
      if (exceedsMaxSize(file, maxSize)) {
        config.onUploadFailed?.({
          reason: "file-too-large",
          file,
          message: `File "${file.name}" exceeds the maximum size of ${formatFileSize(maxSize)}`,
        });
        continue;
      }
      queued.push({
        file,
        placeholder: {
          id: randomUUID(),
          type: getModalityFromMimeType(file.type),
          source: { type: "data", value: "", mimeType: file.type },
          filename: file.name,
          size: file.size,
          status: "uploading",
        },
      });
    }

    if (queued.length === 0) return;

    // The whole selection joins the queue at once, in the order it was picked,
    // so a file waiting for a free slot is already visible.
    this.update([
      ...this.attachments,
      ...queued.map((entry) => entry.placeholder),
    ]);

    // Each file carries the promise this call waits on, so `processFiles`
    // resolves when its own files have settled and no sooner.
    const settled = queued.map(
      ({ file, placeholder }) =>
        new Promise<void>((settle) => {
          this.uploads.push({ file, placeholder, config, settle });
        }),
    );

    // Top the pool up to the limit rather than starting a fresh one: whatever
    // is already draining counts against it, so overlapping selections never
    // exceed the limit together.
    const limit = resolveMaxConcurrentUploads(config.maxConcurrentUploads);
    const toSpawn = Math.min(
      this.uploads.length,
      Math.max(0, limit - this.activeWorkers),
    );
    for (let i = 0; i < toSpawn; i++) {
      void this.drainUploads();
    }

    await Promise.all(settled);
  }

  /**
   * The files to take from a paste: file entries `accept` allows. Text and
   * rejected types stay out, so the paste falls through to the text box. Call
   * `preventDefault()` on the event only when this returns files.
   */
  filterPastedFiles(items: Iterable<ɵClipboardItem>) {
    const config = this.getConfig();
    if (!config?.enabled) return [];
    const accept = config.accept ?? "*/*";
    const files: File[] = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && matchesAcceptFilter(file, accept)) files.push(file);
    }
    return files;
  }

  /** Removes the attachment with this id. An upload still running for it is ignored when it ends. */
  remove(id: string) {
    const next = this.attachments.filter((a) => a.id !== id);
    if (next.length !== this.attachments.length) this.update(next);
  }

  /**
   * Takes the ready attachments out of the queue for a message. Files still
   * uploading stay. Returns an empty array, and notifies no one, when nothing
   * is ready.
   */
  consumeReady() {
    const ready = this.attachments.filter((a) => a.status === "ready");
    if (ready.length > 0) {
      this.update(this.attachments.filter((a) => a.status !== "ready"));
    }
    return ready;
  }

  /** Stops notifying and drops the files still waiting for a slot. */
  dispose() {
    this.disposed = true;
    this.listeners.clear();
    const waiting = this.uploads.splice(0);
    for (const upload of waiting) upload.settle();
  }

  private update(next: Attachment[]) {
    this.attachments = next;
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }

  // One worker: take the next queued file, upload it, repeat until the queue
  // is empty, then give the slot back. Workers are counted rather than owned by
  // a call, which keeps the limit global.
  private async drainUploads() {
    this.activeWorkers++;
    try {
      for (;;) {
        const upload = this.uploads.shift();
        if (!upload) return;
        try {
          await this.upload(upload);
        } catch (error) {
          // `upload` reports its own failures; this is the belt for an
          // unexpected throw, so one file can't strand everything behind it.
          console.error("[CopilotKit] Upload worker error:", error);
        } finally {
          upload.settle();
        }
      }
    } finally {
      this.activeWorkers--;
    }
  }

  // Uploads one file and settles its placeholder: ready with its source on
  // success, gone from the queue on failure.
  private async upload({ file, placeholder, config }: QueuedUpload) {
    try {
      const { metadata, ...source } = config.onUpload
        ? await config.onUpload(file)
        : {
            type: "data" as const,
            value: await readFileAsBase64(file),
            mimeType: file.type,
          };
      const thumbnail =
        placeholder.type === "video"
          ? await generateVideoThumbnail(file)
          : undefined;
      const isStillQueued = this.attachments.some(
        (attachment) => attachment.id === placeholder.id,
      );
      if (this.disposed || !isStillQueued) return;
      this.update(
        this.attachments.map((attachment) =>
          attachment.id === placeholder.id
            ? {
                ...attachment,
                source,
                status: "ready" as const,
                thumbnail,
                metadata,
              }
            : attachment,
        ),
      );
    } catch (error) {
      if (this.disposed) return;
      this.remove(placeholder.id);
      console.error(`[CopilotKit] Failed to upload "${file.name}":`, error);
      config.onUploadFailed?.({
        reason: "upload-failed",
        file,
        message:
          error instanceof Error
            ? error.message
            : `Failed to upload "${file.name}"`,
      });
    }
  }
}

/**
 * The content of a user message: the text alone when there are no
 * attachments, or a text part followed by one part per attachment. Blank text
 * adds no text part. The text is sent as typed, not trimmed.
 *
 * @param text - What the user typed.
 * @param attachments - Ready attachments, from {@link ɵAttachmentQueue.consumeReady}.
 */
export function ɵbuildUserMessageContent(
  text: string,
  attachments: readonly Attachment[],
) {
  if (attachments.length === 0) return text;
  const content: InputContent[] = [];
  if (text.trim()) content.push({ type: "text", text });
  for (const attachment of attachments) {
    content.push(createAttachmentContent(attachment));
  }
  return content;
}
