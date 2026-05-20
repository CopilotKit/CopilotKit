import { nextTick, defineComponent, h, onUpdated, ref } from "vue";
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
});
