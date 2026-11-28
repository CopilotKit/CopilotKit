import {
  nextTick,
  defineComponent,
  h,
  isProxy,
  isReactive,
  onUpdated,
  ref,
} from "vue";
import { render } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import type {
  AttachmentUploadError,
  AttachmentsConfig,
} from "@copilotkit/shared";
import { useAttachments } from "../use-attachments";

function createFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

/** An upload that resolves to an inline data source, for tests that only care about the drop. */
const inlineUpload = async (file: File) => ({
  type: "data" as const,
  value: "dGVzdA==",
  mimeType: file.type,
});

function mountHook(initialConfig: AttachmentsConfig | undefined) {
  const config = ref<AttachmentsConfig | undefined>(initialConfig);
  const trigger = ref(0);
  let updateCount = 0;
  let api: ReturnType<typeof useAttachments> | null = null;

  render(
    defineComponent({
      setup() {
        api = useAttachments({ config });
        onUpdated(() => {
          updateCount += 1;
        });
        return { trigger };
      },
      render() {
        return h("div", String(this.trigger));
      },
    }),
  );

  const rerender = async () => {
    trigger.value += 1;
    await nextTick();
  };

  return {
    config,
    get api() {
      if (!api) {
        throw new Error("Hook harness was not initialized.");
      }
      return api;
    },
    get updateCount() {
      return updateCount;
    },
    rerender,
  };
}

describe("useAttachments", () => {
  describe("referential stability", () => {
    it("all actions are stable across rerenders with same config", async () => {
      const harness = mountHook({ enabled: true, accept: "image/*" });
      const first = harness.api;

      await harness.rerender();
      const second = harness.api;

      expect(second.processFiles).toBe(first.processFiles);
      expect(second.handleFileUpload).toBe(first.handleFileUpload);
      expect(second.handleDragOver).toBe(first.handleDragOver);
      expect(second.handleDragLeave).toBe(first.handleDragLeave);
      expect(second.handleDrop).toBe(first.handleDrop);
      expect(second.removeAttachment).toBe(first.removeAttachment);
      expect(second.consumeAttachments).toBe(first.consumeAttachments);
    });

    it("actions remain stable when config object identity changes", async () => {
      const harness = mountHook({ enabled: true, accept: "image/*" });
      const first = harness.api;

      harness.config.value = { enabled: true, accept: "image/*" };
      await harness.rerender();
      const second = harness.api;

      expect(second.processFiles).toBe(first.processFiles);
      expect(second.handleFileUpload).toBe(first.handleFileUpload);
      expect(second.handleDragOver).toBe(first.handleDragOver);
      expect(second.handleDragLeave).toBe(first.handleDragLeave);
      expect(second.handleDrop).toBe(first.handleDrop);
      expect(second.removeAttachment).toBe(first.removeAttachment);
      expect(second.consumeAttachments).toBe(first.consumeAttachments);
    });

    it("refs are stable across rerenders", async () => {
      const harness = mountHook(undefined);
      const first = harness.api;

      await harness.rerender();
      const second = harness.api;

      expect(second.fileInputRef).toBe(first.fileInputRef);
      expect(second.containerRef).toBe(first.containerRef);
    });
  });

  describe("re-render counting", () => {
    it("does not re-render when consumeAttachments is called on empty queue", async () => {
      const harness = mountHook(undefined);
      const initialUpdateCount = harness.updateCount;

      harness.api.consumeAttachments();
      await nextTick();

      expect(harness.updateCount).toBe(initialUpdateCount);
    });

    it("does not re-render on repeated consumeAttachments for empty queue", async () => {
      const harness = mountHook(undefined);
      const initialUpdateCount = harness.updateCount;

      harness.api.consumeAttachments();
      harness.api.consumeAttachments();
      harness.api.consumeAttachments();
      await nextTick();

      expect(harness.updateCount).toBe(initialUpdateCount);
    });
  });

  describe("initial state", () => {
    it("returns empty attachments and disabled by default", () => {
      const harness = mountHook(undefined);
      expect(harness.api.attachments.value).toEqual([]);
      expect(harness.api.enabled.value).toBe(false);
      expect(harness.api.dragOver.value).toBe(false);
    });

    it("returns enabled when config.enabled is true", () => {
      const harness = mountHook({ enabled: true });
      expect(harness.api.enabled.value).toBe(true);
    });
  });

  describe("consumeAttachments", () => {
    it("returns an empty array when there are no attachments", () => {
      const harness = mountHook(undefined);
      expect(harness.api.consumeAttachments()).toEqual([]);
    });
  });

  describe("removeAttachment", () => {
    it("is a no-op when the id does not exist", () => {
      const harness = mountHook(undefined);
      harness.api.removeAttachment("nonexistent");
      expect(harness.api.attachments.value).toEqual([]);
    });
  });

  describe("latest config reads", () => {
    it("stable actions still observe latest config", async () => {
      const onUploadFailed = vi.fn<(error: AttachmentUploadError) => void>();
      const harness = mountHook({
        enabled: true,
        accept: "image/*",
        onUploadFailed,
      });

      const stableProcessFiles = harness.api.processFiles;
      harness.config.value = {
        enabled: true,
        accept: "audio/*",
        onUploadFailed,
      };
      await harness.rerender();

      const imageFile = createFile("photo.png", 128, "image/png");
      await stableProcessFiles([imageFile]);

      expect(onUploadFailed).toHaveBeenCalledTimes(1);
      expect(onUploadFailed.mock.calls[0][0].reason).toBe("invalid-type");
      expect(onUploadFailed.mock.calls[0][0].message).toContain("audio/*");
    });
  });

  describe("drag and drop", () => {
    /** The part of a drag event the handlers read. */
    function dragEvent(types: string[], files: File[] = []) {
      return {
        dataTransfer: { types, files },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as DragEvent;
    }

    it("opens the drop zone for a drag that carries files", () => {
      const harness = mountHook({ enabled: true, onUpload: inlineUpload });
      const over = dragEvent(["Files"]);

      harness.api.handleDragOver(over);

      expect(harness.api.dragOver.value).toBe(true);
      expect(over.preventDefault).toHaveBeenCalled();
    });

    it("leaves a text drag to the browser", () => {
      const harness = mountHook({ enabled: true, onUpload: inlineUpload });
      const over = dragEvent(["text/plain"]);

      harness.api.handleDragOver(over);

      expect(harness.api.dragOver.value).toBe(false);
      expect(over.preventDefault).not.toHaveBeenCalled();
      expect(over.stopPropagation).not.toHaveBeenCalled();
    });

    it("does not take a text drop", async () => {
      const harness = mountHook({ enabled: true, onUpload: inlineUpload });
      const drop = dragEvent(["text/plain"]);

      await harness.api.handleDrop(drop);

      expect(drop.preventDefault).not.toHaveBeenCalled();
      expect(harness.api.attachments.value).toEqual([]);
    });

    it("closes the drop zone when that drag leaves", () => {
      const harness = mountHook({ enabled: true, onUpload: inlineUpload });

      harness.api.handleDragOver(dragEvent(["Files"]));
      expect(harness.api.dragOver.value).toBe(true);

      harness.api.handleDragLeave(dragEvent(["Files"]));

      expect(harness.api.dragOver.value).toBe(false);
    });

    it("takes a file drop and closes the drop zone", async () => {
      const harness = mountHook({ enabled: true, onUpload: inlineUpload });

      harness.api.handleDragOver(dragEvent(["Files"]));
      expect(harness.api.dragOver.value).toBe(true);

      const drop = dragEvent(
        ["Files"],
        [createFile("report.pdf", 128, "application/pdf")],
      );
      await harness.api.handleDrop(drop);

      expect(drop.preventDefault).toHaveBeenCalled();
      expect(harness.api.dragOver.value).toBe(false);
      expect(harness.api.attachments.value.map((a) => a.filename)).toEqual([
        "report.pdf",
      ]);
    });
  });

  describe("Vue-specific reactive semantics", () => {
    it("keeps uploaded attachment source cloneable and non-reactive", async () => {
      const harness = mountHook({
        enabled: true,
        onUpload: async () => ({
          type: "url",
          value: "https://example.com/report.pdf",
          mimeType: "application/pdf",
          metadata: { source: "test-upload" },
        }),
      });

      await harness.api.processFiles([
        createFile("report.pdf", 128, "application/pdf"),
      ]);

      const [attachment] = harness.api.attachments.value;
      expect(attachment).toBeDefined();
      expect(attachment.source).toEqual({
        type: "url",
        value: "https://example.com/report.pdf",
        mimeType: "application/pdf",
      });
      expect(isProxy(attachment.source)).toBe(false);
      expect(isReactive(attachment.source)).toBe(false);
      expect(() => structuredClone(attachment.source)).not.toThrow();

      const [consumed] = harness.api.consumeAttachments();
      expect(consumed).toBeDefined();
      expect(isProxy(consumed.source)).toBe(false);
      expect(isReactive(consumed.source)).toBe(false);
      expect(() => structuredClone(consumed.source)).not.toThrow();
    });
  });
});
