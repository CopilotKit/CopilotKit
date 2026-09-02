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
  // Upload concurrency
  // -----------------------------------------------------------------------

  describe("upload concurrency", () => {
    // setupTests mocks `randomUUID` to a constant, which would give every queued file
    // the same attachment id — and each upload settles its own placeholder by id.
    beforeEach(() => {
      let nextId = 0;
      vi.mocked(randomUUID).mockImplementation(() => `attachment-${nextId++}`);
    });

    afterEach(() => {
      vi.mocked(randomUUID).mockReturnValue("mock-thread-id");
    });

    /**
     * A set of image files plus one gate per file, so a test decides when each
     * upload finishes and can observe how many are in flight meanwhile.
     */
    function gatedUploads(count: number) {
      const files = Array.from(
        { length: count },
        (_, i) => new File(["x"], `file-${i}.png`, { type: "image/png" }),
      );
      const gates = files.map(() => deferred());
      const started: string[] = [];
      let inFlight = 0;
      let peakInFlight = 0;

      const onUpload = async (file: File) => {
        const index = files.indexOf(file);
        started.push(file.name);
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        try {
          await gates[index].promise;
        } finally {
          inFlight--;
        }
        return {
          type: "data" as const,
          value: "dGVzdA==",
          mimeType: file.type,
        };
      };

      return {
        files,
        gates,
        started,
        onUpload,
        peak: () => peakInFlight,
      };
    }

    it("uploads three files at a time by default", async () => {
      const { files, gates, started, onUpload, peak } = gatedUploads(7);
      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true, onUpload } }),
      );

      let processing!: Promise<void>;
      await act(async () => {
        processing = result.current.processFiles(files);
      });

      // Three in flight, the rest waiting for a slot.
      expect(started).toEqual(["file-0.png", "file-1.png", "file-2.png"]);

      await act(async () => {
        gates.forEach((gate) => gate.resolve());
        await processing;
      });

      expect(peak()).toBe(3);
      expect(started).toHaveLength(7);
      expect(result.current.attachments.map((a) => a.status)).toEqual(
        Array(7).fill("ready"),
      );
    });

    it("queues every picked file immediately, in pick order", async () => {
      const { files, gates, onUpload } = gatedUploads(5);
      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true, onUpload } }),
      );

      let processing!: Promise<void>;
      await act(async () => {
        processing = result.current.processFiles(files);
      });

      // All five are visible as "uploading" even though only three have started.
      expect(result.current.attachments.map((a) => a.filename)).toEqual(
        files.map((f) => f.name),
      );
      expect(result.current.attachments.map((a) => a.status)).toEqual(
        Array(5).fill("uploading"),
      );

      await act(async () => {
        gates.forEach((gate) => gate.resolve());
        await processing;
      });
    });

    it("uploads one at a time when maxConcurrentUploads is 1", async () => {
      const { files, gates, started, onUpload, peak } = gatedUploads(4);
      const { result } = renderHook(() =>
        useAttachments({
          config: { enabled: true, onUpload, maxConcurrentUploads: 1 },
        }),
      );

      let processing!: Promise<void>;
      await act(async () => {
        processing = result.current.processFiles(files);
      });

      expect(started).toEqual(["file-0.png"]);

      await act(async () => {
        gates.forEach((gate) => gate.resolve());
        await processing;
      });

      expect(peak()).toBe(1);
      expect(started).toHaveLength(4);
    });

    it("treats a non-positive maxConcurrentUploads as one at a time", async () => {
      const { files, gates, onUpload, peak } = gatedUploads(3);
      const { result } = renderHook(() =>
        useAttachments({
          config: { enabled: true, onUpload, maxConcurrentUploads: 0 },
        }),
      );

      let processing!: Promise<void>;
      await act(async () => {
        processing = result.current.processFiles(files);
      });

      await act(async () => {
        gates.forEach((gate) => gate.resolve());
        await processing;
      });

      expect(peak()).toBe(1);
    });

    it("keeps uploading the rest when one file fails", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const onUploadFailed = vi.fn();
      const { files, gates, onUpload } = gatedUploads(3);
      const { result } = renderHook(() =>
        useAttachments({ config: { enabled: true, onUpload, onUploadFailed } }),
      );

      let processing!: Promise<void>;
      await act(async () => {
        processing = result.current.processFiles(files);
      });

      await act(async () => {
        gates[1].reject(new Error("storage rejected the file"));
        gates[0].resolve();
        gates[2].resolve();
        await processing;
      });

      // The failed file leaves the queue; the other two are still sendable.
      expect(result.current.attachments.map((a) => a.filename)).toEqual([
        "file-0.png",
        "file-2.png",
      ]);
      expect(onUploadFailed).toHaveBeenCalledTimes(1);
      expect(onUploadFailed.mock.calls[0][0]).toMatchObject({
        reason: "upload-failed",
        message: "storage rejected the file",
      });

      consoleError.mockRestore();
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
