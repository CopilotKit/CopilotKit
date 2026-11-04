import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AttachmentUploadError,
  AttachmentsConfig,
} from "@copilotkit/shared";
import {
  ɵAttachmentQueue,
  ɵbuildUserMessageContent,
} from "../attachment-queue";

/** A promise a test settles by hand, to hold an upload open or fail it on cue. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function imageFile(name: string, size = 1) {
  return new File(["x".repeat(size)], name, { type: "image/png" });
}

/**
 * A set of image files plus one gate per file, so a test decides when each
 * upload finishes and can observe how many are in flight meanwhile.
 */
function gatedUploads(count: number) {
  const files = Array.from({ length: count }, (_, i) =>
    imageFile(`file-${i}.png`),
  );
  const gates = files.map(() => deferred());
  const started: string[] = [];
  let inFlight = 0;
  let peakInFlight = 0;

  const onUpload = async (file: File) => {
    started.push(file.name);
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      await gates[files.indexOf(file)]?.promise;
    } finally {
      inFlight--;
    }
    return { type: "url" as const, value: `https://cdn/${file.name}` };
  };

  return {
    files,
    started,
    onUpload,
    peak: () => peakInFlight,
    resolve: (index: number) => gates[index]?.resolve(),
    reject: (index: number, error: Error) => gates[index]?.reject(error),
    resolveAll: () => gates.forEach((gate) => gate.resolve()),
  };
}

function createQueue(config: Partial<AttachmentsConfig> = {}) {
  return new ɵAttachmentQueue(() => ({ enabled: true, ...config }));
}

const statuses = (queue: ɵAttachmentQueue) =>
  queue.getSnapshot().map((a) => a.status);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ɵAttachmentQueue validation", () => {
  it("rejects a file of a type `accept` excludes", async () => {
    const failures: AttachmentUploadError[] = [];
    const queue = createQueue({
      accept: "image/*",
      onUploadFailed: (error) => failures.push(error),
    });
    const pdf = new File(["x"], "doc.pdf", { type: "application/pdf" });

    await queue.processFiles([pdf]);

    expect(queue.getSnapshot()).toEqual([]);
    expect(failures).toEqual([
      {
        reason: "invalid-type",
        file: pdf,
        message: 'File "doc.pdf" is not accepted. Supported types: image/*',
      },
    ]);
  });

  it("rejects a file larger than `maxSize`", async () => {
    const failures: AttachmentUploadError[] = [];
    const queue = createQueue({
      maxSize: 1024,
      onUploadFailed: (error) => failures.push(error),
    });
    const big = imageFile("big.png", 2048);

    await queue.processFiles([big]);

    expect(queue.getSnapshot()).toEqual([]);
    expect(failures).toEqual([
      {
        reason: "file-too-large",
        file: big,
        message: 'File "big.png" exceeds the maximum size of 1.0 KB',
      },
    ]);
  });

  it("does nothing while attachments are disabled", async () => {
    const onUpload = vi.fn();
    const queue = new ɵAttachmentQueue(() => ({ enabled: false, onUpload }));

    await queue.processFiles([imageFile("a.png")]);

    expect(queue.getSnapshot()).toEqual([]);
    expect(onUpload).not.toHaveBeenCalled();
  });
});

describe("ɵAttachmentQueue uploads", () => {
  it("marks a file ready with the source and metadata `onUpload` returns", async () => {
    const queue = createQueue({
      onUpload: () => ({
        type: "url",
        value: "https://cdn/a.png",
        mimeType: "image/png",
        metadata: { key: "a" },
      }),
    });

    await queue.processFiles([imageFile("a.png")]);

    expect(queue.getSnapshot()).toEqual([
      expect.objectContaining({
        type: "image",
        filename: "a.png",
        status: "ready",
        source: {
          type: "url",
          value: "https://cdn/a.png",
          mimeType: "image/png",
        },
        metadata: { key: "a" },
      }),
    ]);
  });

  it("reads the file as base64 when there is no `onUpload`", async () => {
    // FileReader is a browser API; stand in for it at that boundary.
    class FakeFileReader {
      onload: ((event: { target: { result: string } }) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.({ target: { result: "data:image/png;base64,QUJD" } });
      }
    }
    vi.stubGlobal("FileReader", FakeFileReader);
    const queue = createQueue();

    await queue.processFiles([imageFile("a.png")]);

    expect(queue.getSnapshot()[0]?.source).toEqual({
      type: "data",
      value: "QUJD",
      mimeType: "image/png",
    });
  });

  it("uploads one at a time by default", async () => {
    const { files, resolveAll, started, onUpload, peak } = gatedUploads(4);
    const queue = createQueue({ onUpload });

    const processing = queue.processFiles(files);
    await Promise.resolve();

    expect(started).toEqual(["file-0.png"]);
    resolveAll();
    await processing;
    expect(peak()).toBe(1);
    expect(statuses(queue)).toEqual(Array(4).fill("ready"));
  });

  it("shows every picked file as uploading at once, in pick order", async () => {
    const { files, resolveAll, onUpload } = gatedUploads(3);
    const queue = createQueue({ onUpload });

    const processing = queue.processFiles(files);

    expect(queue.getSnapshot().map((a) => a.filename)).toEqual([
      "file-0.png",
      "file-1.png",
      "file-2.png",
    ]);
    expect(statuses(queue)).toEqual(Array(3).fill("uploading"));
    expect(queue.isUploading()).toBe(true);
    resolveAll();
    await processing;
    expect(queue.isUploading()).toBe(false);
  });

  it.each([
    { limit: 3, expectedPeak: 3 },
    { limit: 0, expectedPeak: 1 },
    { limit: Infinity, expectedPeak: 6 },
  ])(
    "runs at most $expectedPeak uploads when maxConcurrentUploads is $limit",
    async ({ limit, expectedPeak }) => {
      const { files, resolveAll, onUpload, peak } = gatedUploads(6);
      const queue = createQueue({ onUpload, maxConcurrentUploads: limit });

      const processing = queue.processFiles(files);
      resolveAll();
      await processing;

      expect(peak()).toBe(expectedPeak);
    },
  );

  it("holds the limit across overlapping processFiles calls", async () => {
    const { files, resolveAll, started, onUpload, peak } = gatedUploads(6);
    const queue = createQueue({ onUpload, maxConcurrentUploads: 2 });

    const first = queue.processFiles(files.slice(0, 3));
    const second = queue.processFiles(files.slice(3));
    await Promise.resolve();

    expect(started).toEqual(["file-0.png", "file-1.png"]);
    resolveAll();
    await Promise.all([first, second]);
    expect(peak()).toBe(2);
    expect(statuses(queue)).toEqual(Array(6).fill("ready"));
  });

  it("drops a failed file, reports it, and keeps uploading the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failures: AttachmentUploadError[] = [];
    const { files, resolve, reject, onUpload } = gatedUploads(3);
    const queue = createQueue({
      onUpload,
      onUploadFailed: (error) => failures.push(error),
    });

    const processing = queue.processFiles(files);
    reject(1, new Error("storage rejected the file"));
    resolve(0);
    resolve(2);
    await processing;

    expect(queue.getSnapshot().map((a) => a.filename)).toEqual([
      "file-0.png",
      "file-2.png",
    ]);
    expect(failures).toEqual([
      {
        reason: "upload-failed",
        file: files[1],
        message: "storage rejected the file",
      },
    ]);
  });

  it("ignores an upload that finishes after its attachment was removed", async () => {
    const { files, resolve, onUpload } = gatedUploads(1);
    const queue = createQueue({ onUpload });

    const processing = queue.processFiles(files);
    queue.remove(queue.getSnapshot()[0]!.id);
    resolve(0);
    await processing;

    expect(queue.getSnapshot()).toEqual([]);
  });
});

describe("ɵAttachmentQueue state", () => {
  it("consumeReady takes the ready attachments and leaves the uploading ones", async () => {
    const { files, resolve, onUpload } = gatedUploads(2);
    const queue = createQueue({ onUpload, maxConcurrentUploads: 2 });

    const processing = queue.processFiles(files);
    resolve(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const consumed = queue.consumeReady();

    expect(consumed.map((a) => a.filename)).toEqual(["file-0.png"]);
    expect(queue.getSnapshot().map((a) => a.filename)).toEqual(["file-1.png"]);
    resolve(1);
    await processing;
  });

  it("keeps the snapshot and notifies no one when nothing changes", () => {
    const queue = createQueue();
    const listener = vi.fn();
    queue.subscribe(listener);
    const before = queue.getSnapshot();

    expect(queue.consumeReady()).toEqual([]);
    queue.remove("missing");

    expect(queue.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after dispose", async () => {
    const { files, resolve, onUpload } = gatedUploads(1);
    const queue = createQueue({ onUpload });
    const listener = vi.fn();
    queue.subscribe(listener);

    const processing = queue.processFiles(files);
    listener.mockClear();
    queue.dispose();
    resolve(0);
    await processing;

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("ɵAttachmentQueue.filterPastedFiles", () => {
  const item = (kind: string, file: File | null) => ({
    kind,
    getAsFile: () => file,
  });

  it("keeps accepted file entries and drops text and other types", () => {
    const queue = createQueue({ accept: "image/*" });
    const png = imageFile("a.png");
    const pdf = new File(["x"], "b.pdf", { type: "application/pdf" });

    const files = queue.filterPastedFiles([
      item("string", null),
      item("file", png),
      item("file", pdf),
      item("file", null),
    ]);

    expect(files).toEqual([png]);
  });

  it("takes nothing while attachments are disabled", () => {
    const queue = new ɵAttachmentQueue(() => undefined);

    expect(queue.filterPastedFiles([item("file", imageFile("a.png"))])).toEqual(
      [],
    );
  });
});

describe("ɵbuildUserMessageContent", () => {
  const attachment = {
    id: "1",
    type: "image" as const,
    source: { type: "url" as const, value: "https://cdn/a.png" },
    filename: "a.png",
    status: "ready" as const,
  };

  it("returns the text alone when there are no attachments", () => {
    expect(ɵbuildUserMessageContent("hello", [])).toBe("hello");
  });

  it("puts the untrimmed text first, then one part per attachment", () => {
    expect(ɵbuildUserMessageContent(" hi ", [attachment])).toEqual([
      { type: "text", text: " hi " },
      {
        type: "image",
        source: { type: "url", value: "https://cdn/a.png" },
        metadata: { filename: "a.png" },
      },
    ]);
  });

  it("adds no text part for blank text", () => {
    expect(ɵbuildUserMessageContent("  ", [attachment])).toEqual([
      {
        type: "image",
        source: { type: "url", value: "https://cdn/a.png" },
        metadata: { filename: "a.png" },
      },
    ]);
  });
});
