import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CopilotChatAttachmentQueue,
  CopilotChatAttachmentQueueItem,
} from "../copilot-chat-attachment-queue";
import type {
  Attachment,
  AttachmentQueueRemoveEvent,
} from "../copilot-chat-attachment-queue.types";

const imageReady: Attachment = {
  id: "att-1",
  type: "image",
  status: "ready",
  filename: "photo.png",
  source: { type: "data", value: "IMGB64", mimeType: "image/png" },
};

const docUploading: Attachment = {
  id: "att-2",
  type: "document",
  status: "uploading",
  filename: "report.pdf",
  size: 2_500_000,
  source: { type: "data", value: "PDFB64", mimeType: "application/pdf" },
};

const videoReady: Attachment = {
  id: "att-3",
  type: "video",
  status: "ready",
  filename: "clip.mp4",
  thumbnail: "data:image/jpeg;base64,THUMB",
  source: { type: "url", value: "https://example.com/clip.mp4", mimeType: "video/mp4" },
};

interface QueueBindings {
  attachments: ReturnType<typeof signal<Attachment[]>>;
  inputClass: ReturnType<typeof signal<string | undefined>>;
}

function buildQueue(initial: {
  attachments?: Attachment[];
  inputClass?: string;
}): { component: CopilotChatAttachmentQueue; bindings: QueueBindings } {
  const injector = TestBed.inject(EnvironmentInjector);
  const component = runInInjectionContext(
    injector,
    () => new CopilotChatAttachmentQueue(),
  );
  const bindings: QueueBindings = {
    attachments: signal<Attachment[]>(initial.attachments ?? []),
    inputClass: signal(initial.inputClass),
  };
  (component as unknown as { attachments: () => Attachment[] }).attachments =
    () => bindings.attachments();
  (
    component as unknown as { inputClass: () => string | undefined }
  ).inputClass = () => bindings.inputClass();
  return { component, bindings };
}

describe("CopilotChatAttachmentQueue", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it("produces one entry per attachment, keyed by attachment.id", () => {
    const { component } = buildQueue({
      attachments: [imageReady, docUploading, videoReady],
    });
    const entries = component.entries();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.key)).toEqual(["att-1", "att-2", "att-3"]);
  });

  it("returns no entries for an empty attachments list", () => {
    const { component } = buildQueue({ attachments: [] });
    expect(component.entries()).toEqual([]);
  });

  it("marks uploading attachments via the entry's isUploading flag", () => {
    const { component } = buildQueue({
      attachments: [imageReady, docUploading],
    });
    const [first, second] = component.entries();
    expect(first.context.isUploading).toBe(false);
    expect(second.context.isUploading).toBe(true);
  });

  it("computes src as a base64 data URL for ready data sources", () => {
    const { component } = buildQueue({ attachments: [imageReady] });
    expect(component.entries()[0].context.src).toBe(
      "data:image/png;base64,IMGB64",
    );
  });

  it("computes src as the URL for ready url sources", () => {
    const { component } = buildQueue({ attachments: [videoReady] });
    expect(component.entries()[0].context.src).toBe(
      "https://example.com/clip.mp4",
    );
  });

  it("emits an empty src for uploading attachments (preview is hidden)", () => {
    const { component } = buildQueue({ attachments: [docUploading] });
    expect(component.entries()[0].context.src).toBe("");
  });

  it("emits removeAttachment with id and attachment when clickHandler runs", () => {
    const { component } = buildQueue({
      attachments: [imageReady, docUploading],
    });
    const events: AttachmentQueueRemoveEvent[] = [];
    component.removeAttachment.subscribe((e) => events.push(e));

    component.entries()[1].context.clickHandler();

    expect(events).toEqual([{ id: "att-2", attachment: docUploading }]);
  });

  it("emits removeAttachment when handleRemove is invoked directly", () => {
    const { component } = buildQueue({ attachments: [imageReady] });
    const spy = vi.fn();
    component.removeAttachment.subscribe(spy);

    component.handleRemove(imageReady);

    expect(spy).toHaveBeenCalledWith({ id: "att-1", attachment: imageReady });
  });

  it("recomputes entries when the attachments input changes", () => {
    const { component, bindings } = buildQueue({
      attachments: [imageReady],
    });
    expect(component.entries()).toHaveLength(1);

    bindings.attachments.set([imageReady, videoReady]);
    expect(component.entries()).toHaveLength(2);
    expect(component.entries()[1].key).toBe("att-3");
  });

  it("exposes a container context with the current attachments and inputClass", () => {
    const { component, bindings } = buildQueue({
      attachments: [imageReady],
      inputClass: "ring-2",
    });
    expect(component.containerContext()).toEqual({
      attachments: [imageReady],
      inputClass: "ring-2",
    });

    bindings.inputClass.set("ring-red");
    expect(component.containerContext().inputClass).toBe("ring-red");
  });
});

interface ItemBindings {
  attachment: ReturnType<typeof signal<Attachment>>;
  src: ReturnType<typeof signal<string>>;
  isUploading: ReturnType<typeof signal<boolean>>;
  clickHandler: ReturnType<
    typeof signal<((event?: Event) => void) | undefined>
  >;
}

function buildItem(initial: {
  attachment: Attachment;
  src?: string;
  isUploading?: boolean;
  clickHandler?: (event?: Event) => void;
}): { component: CopilotChatAttachmentQueueItem; bindings: ItemBindings } {
  const injector = TestBed.inject(EnvironmentInjector);
  const component = runInInjectionContext(
    injector,
    () => new CopilotChatAttachmentQueueItem(),
  );
  const bindings: ItemBindings = {
    attachment: signal<Attachment>(initial.attachment),
    src: signal(initial.src ?? ""),
    isUploading: signal(initial.isUploading ?? false),
    clickHandler: signal(initial.clickHandler),
  };
  (component as unknown as { attachment: () => Attachment }).attachment = () =>
    bindings.attachment();
  (component as unknown as { src: () => string }).src = () => bindings.src();
  (component as unknown as { isUploading: () => boolean }).isUploading = () =>
    bindings.isUploading();
  (
    component as unknown as {
      clickHandler: () => ((event?: Event) => void) | undefined;
    }
  ).clickHandler = () => bindings.clickHandler();
  return { component, bindings };
}

describe("CopilotChatAttachmentQueueItem", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it("computes a document icon based on the attachment's mimeType", () => {
    const { component } = buildItem({ attachment: docUploading });
    expect(component.documentIcon()).toBe("PDF");
  });

  it("formats size via formatFileSize when present", () => {
    const { component } = buildItem({ attachment: docUploading });
    // 2_500_000 / 1024 / 1024 ~= 2.4 MB
    expect(component.formattedSize()).toBe("2.4 MB");
  });

  it("returns an empty string for formattedSize when size is missing", () => {
    const { component } = buildItem({ attachment: imageReady });
    expect(component.formattedSize()).toBe("");
  });

  it("invokes the provided clickHandler and emits removed when handleRemove runs", () => {
    const handler = vi.fn();
    const removed = vi.fn();
    const { component } = buildItem({
      attachment: imageReady,
      clickHandler: handler,
    });
    component.removed.subscribe(removed);

    const evt = new Event("click");
    component.handleRemove(evt);

    expect(handler).toHaveBeenCalledWith(evt);
    expect(removed).toHaveBeenCalledWith(evt);
  });

  it("emits removed even when no clickHandler is provided", () => {
    const removed = vi.fn();
    const { component } = buildItem({ attachment: imageReady });
    component.removed.subscribe(removed);

    const evt = new Event("click");
    component.handleRemove(evt);

    expect(removed).toHaveBeenCalledWith(evt);
  });
});
