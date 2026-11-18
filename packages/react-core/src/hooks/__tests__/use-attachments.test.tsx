import React, { useRef, useEffect } from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "@copilotkit/shared";
import { useAttachments } from "../use-attachments";

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

describe("useAttachments", () => {
  // -----------------------------------------------------------------------
  // Referential stability — callbacks must not change between renders
  // -----------------------------------------------------------------------

  describe("referential stability", () => {
    it("all callbacks are stable across re-renders with same config", () => {
      const config = { enabled: true, accept: "image/*" };
      const { result, rerender } = renderHook(() => useAttachments({ config }));

      const first = result.current;
      rerender();
      const second = result.current;

      expect(second.processFiles).toBe(first.processFiles);
      expect(second.handleFileUpload).toBe(first.handleFileUpload);
      expect(second.handleDragOver).toBe(first.handleDragOver);
      expect(second.handleDragLeave).toBe(first.handleDragLeave);
      expect(second.handleDrop).toBe(first.handleDrop);
      expect(second.removeAttachment).toBe(first.removeAttachment);
      expect(second.consumeAttachments).toBe(first.consumeAttachments);
    });

    it("callbacks remain stable when config object reference changes", () => {
      let config = { enabled: true, accept: "image/*" };
      const { result, rerender } = renderHook(() => useAttachments({ config }));

      const first = result.current;

      // Create a new config with same values — different reference
      config = { enabled: true, accept: "image/*" };
      rerender();
      const second = result.current;

      expect(second.processFiles).toBe(first.processFiles);
      expect(second.handleFileUpload).toBe(first.handleFileUpload);
      expect(second.handleDragOver).toBe(first.handleDragOver);
      expect(second.handleDragLeave).toBe(first.handleDragLeave);
      expect(second.handleDrop).toBe(first.handleDrop);
      expect(second.removeAttachment).toBe(first.removeAttachment);
      expect(second.consumeAttachments).toBe(first.consumeAttachments);
    });

    it("refs are stable across re-renders", () => {
      const { result, rerender } = renderHook(() =>
        useAttachments({ config: undefined }),
      );

      const first = result.current;
      rerender();
      const second = result.current;

      expect(second.fileInputRef).toBe(first.fileInputRef);
      expect(second.containerRef).toBe(first.containerRef);
    });
  });

  // -----------------------------------------------------------------------
  // Re-render counting — hook should not cause unnecessary renders
  // -----------------------------------------------------------------------

  describe("re-render counting", () => {
    it("does not re-render when consumeAttachments is called on empty queue", () => {
      let renderCount = 0;

      const { result } = renderHook(() => {
        renderCount++;
        return useAttachments({ config: undefined });
      });

      const initialRenderCount = renderCount;

      act(() => {
        result.current.consumeAttachments();
      });

      // consumeAttachments on empty queue should not trigger a state update
      expect(renderCount).toBe(initialRenderCount);
    });

    it("does not re-render on repeated consumeAttachments with empty queue", () => {
      let renderCount = 0;

      const { result } = renderHook(() => {
        renderCount++;
        return useAttachments({ config: undefined });
      });

      const initialRenderCount = renderCount;

      act(() => {
        result.current.consumeAttachments();
        result.current.consumeAttachments();
        result.current.consumeAttachments();
      });

      expect(renderCount).toBe(initialRenderCount);
    });
  });

  // -----------------------------------------------------------------------
  // State defaults
  // -----------------------------------------------------------------------

  describe("initial state", () => {
    it("returns empty attachments and disabled by default", () => {
      const { result } = renderHook(() =>
        useAttachments({ config: undefined }),
      );

      expect(result.current.attachments).toEqual([]);
      expect(result.current.enabled).toBe(false);
      expect(result.current.dragOver).toBe(false);
    });

    it("returns enabled when config.enabled is true", () => {
      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true } }),
      );

      expect(result.current.enabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // consumeAttachments behavior
  // -----------------------------------------------------------------------

  describe("consumeAttachments", () => {
    it("returns empty array when no attachments", () => {
      const { result } = renderHook(() =>
        useAttachments({ config: undefined }),
      );

      let consumed: any[];
      act(() => {
        consumed = result.current.consumeAttachments();
      });

      expect(consumed!).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Uploads — the queue rules live in core (attachment-queue.test.ts); this
  // pins that the hook re-renders with the queue's state.
  // -----------------------------------------------------------------------

  describe("uploads", () => {
    beforeEach(() => {
      let nextId = 0;
      vi.mocked(randomUUID).mockImplementation(() => `attachment-${nextId++}`);
    });

    afterEach(() => {
      vi.mocked(randomUUID).mockReturnValue("mock-thread-id");
    });

    it("shows a picked file as uploading, then ready", async () => {
      const gate = deferred();
      const onUpload = async () => {
        await gate.promise;
        return { type: "url" as const, value: "https://cdn/a.png" };
      };
      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true, onUpload } }),
      );

      let processing!: Promise<void>;
      await act(async () => {
        processing = result.current.processFiles([
          new File(["x"], "a.png", { type: "image/png" }),
        ]);
      });
      expect(result.current.attachments.map((a) => a.status)).toEqual([
        "uploading",
      ]);

      await act(async () => {
        gate.resolve();
        await processing;
      });
      expect(result.current.attachments.map((a) => a.status)).toEqual([
        "ready",
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // removeAttachment
  // -----------------------------------------------------------------------

  describe("removeAttachment", () => {
    it("is a no-op when id does not exist", () => {
      const { result } = renderHook(() =>
        useAttachments({ config: undefined }),
      );

      const before = result.current.attachments;

      act(() => {
        result.current.removeAttachment("nonexistent");
      });

      // Should still be empty, no crash
      expect(result.current.attachments).toEqual([]);
    });
  });
});
