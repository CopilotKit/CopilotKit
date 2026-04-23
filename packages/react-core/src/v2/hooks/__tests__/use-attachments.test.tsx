import React, { useRef, useEffect } from "react";
import { act } from "@testing-library/react";
import { renderHook } from "../../../test-helpers/render-hook";
import { describe, it, expect, vi } from "vitest";
import { useAttachments } from "../use-attachments";

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
