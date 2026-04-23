import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as shared from "@copilotkit/shared";
import { useMessageQueue } from "../use-message-queue";
import type { InputContent } from "@copilotkit/shared";

const textContent = (text: string): InputContent[] => [{ type: "text", text }];

describe("useMessageQueue", () => {
  beforeEach(() => {
    // Global test setup mocks randomUUID to a constant; override with a
    // counter so enqueued items get unique IDs.
    let counter = 0;
    vi.mocked(shared.randomUUID).mockImplementation(
      () => `queued-${++counter}` as string,
    );
  });

  describe("enqueue / removeAt", () => {
    it("enqueue appends items with unique ids", () => {
      const onDrain = vi.fn();
      const { result } = renderHook(() =>
        useMessageQueue({
          enabled: true,
          dispatch: "sequential",
          isRunning: true,
          onDrain,
        }),
      );

      act(() => {
        result.current.enqueue(textContent("first"));
        result.current.enqueue(textContent("second"));
      });

      expect(result.current.items).toHaveLength(2);
      expect(result.current.items[0].content).toEqual(textContent("first"));
      expect(result.current.items[1].content).toEqual(textContent("second"));
      expect(result.current.items[0].id).not.toEqual(result.current.items[1].id);
    });

    it("enqueue is a no-op when !enabled", () => {
      const { result } = renderHook(() =>
        useMessageQueue({
          enabled: false,
          dispatch: "sequential",
          isRunning: true,
          onDrain: vi.fn(),
        }),
      );

      act(() => {
        result.current.enqueue(textContent("dropped"));
      });

      expect(result.current.items).toHaveLength(0);
    });

    it("enqueue respects maxSize and warns to console", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = renderHook(() =>
        useMessageQueue({
          enabled: true,
          dispatch: "sequential",
          isRunning: true,
          maxSize: 2,
          onDrain: vi.fn(),
        }),
      );

      act(() => {
        result.current.enqueue(textContent("a"));
        result.current.enqueue(textContent("b"));
        result.current.enqueue(textContent("c"));
      });

      expect(result.current.items).toHaveLength(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("max size"),
      );
      warnSpy.mockRestore();
    });

    it("removeAt removes the matching item", () => {
      const { result } = renderHook(() =>
        useMessageQueue({
          enabled: true,
          dispatch: "sequential",
          isRunning: true,
          onDrain: vi.fn(),
        }),
      );

      act(() => {
        result.current.enqueue(textContent("a"));
        result.current.enqueue(textContent("b"));
      });

      const idToRemove = result.current.items[0].id;
      act(() => {
        result.current.removeAt(idToRemove);
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].content).toEqual(textContent("b"));
    });
  });

  describe("reorder + editAt", () => {
    it("moveUp swaps with the previous item, no-op at top", () => {
      const { result } = renderHook(() =>
        useMessageQueue({
          enabled: true,
          dispatch: "sequential",
          isRunning: true,
          onDrain: vi.fn(),
        }),
      );

      act(() => {
        result.current.enqueue(textContent("a"));
        result.current.enqueue(textContent("b"));
        result.current.enqueue(textContent("c"));
      });

      const bId = result.current.items[1].id;
      act(() => result.current.moveUp(bId));

      expect(
        result.current.items.map((i) =>
          i.content[0].type === "text" ? i.content[0].text : "",
        ),
      ).toEqual(["b", "a", "c"]);

      // Move up again — b is already at top, expect no-op
      act(() => result.current.moveUp(bId));
      expect(result.current.items[0].content).toEqual(textContent("b"));
    });

    it("moveDown swaps with the next item, no-op at bottom", () => {
      const { result } = renderHook(() =>
        useMessageQueue({
          enabled: true,
          dispatch: "sequential",
          isRunning: true,
          onDrain: vi.fn(),
        }),
      );

      act(() => {
        result.current.enqueue(textContent("a"));
        result.current.enqueue(textContent("b"));
      });

      const aId = result.current.items[0].id;
      act(() => result.current.moveDown(aId));
      expect(result.current.items[0].content).toEqual(textContent("b"));
      expect(result.current.items[1].content).toEqual(textContent("a"));

      // 'a' is now at bottom — moveDown should no-op
      act(() => result.current.moveDown(aId));
      expect(result.current.items[1].content).toEqual(textContent("a"));
    });

    it("editAt updates content in place", () => {
      const { result } = renderHook(() =>
        useMessageQueue({
          enabled: true,
          dispatch: "sequential",
          isRunning: true,
          onDrain: vi.fn(),
        }),
      );

      act(() => {
        result.current.enqueue(textContent("original"));
      });

      const id = result.current.items[0].id;
      act(() => result.current.editAt(id, textContent("edited")));

      expect(result.current.items[0].content).toEqual(textContent("edited"));
    });
  });

  describe("dispatch: sequential", () => {
    it("drains head on isRunning true→false transition", () => {
      const onDrain = vi.fn();
      let isRunning = true;
      const { result, rerender } = renderHook(
        ({ isRunning }) =>
          useMessageQueue({
            enabled: true,
            dispatch: "sequential",
            isRunning,
            onDrain,
          }),
        { initialProps: { isRunning } },
      );

      act(() => {
        result.current.enqueue(textContent("first"));
        result.current.enqueue(textContent("second"));
      });

      expect(onDrain).not.toHaveBeenCalled();

      isRunning = false;
      rerender({ isRunning });

      expect(onDrain).toHaveBeenCalledTimes(1);
      expect(onDrain).toHaveBeenCalledWith(textContent("first"));
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].content).toEqual(textContent("second"));
    });

    it("does not drain when queue is empty", () => {
      const onDrain = vi.fn();
      let isRunning = true;
      const { rerender } = renderHook(
        ({ isRunning }) =>
          useMessageQueue({
            enabled: true,
            dispatch: "sequential",
            isRunning,
            onDrain,
          }),
        { initialProps: { isRunning } },
      );

      isRunning = false;
      rerender({ isRunning });

      expect(onDrain).not.toHaveBeenCalled();
    });
  });

  describe("dispatch: merged", () => {
    it("combines text with blank-line separators and appends attachments", () => {
      const onDrain = vi.fn();
      let isRunning = true;
      const { result, rerender } = renderHook(
        ({ isRunning }) =>
          useMessageQueue({
            enabled: true,
            dispatch: "merged",
            isRunning,
            onDrain,
          }),
        { initialProps: { isRunning } },
      );

      act(() => {
        result.current.enqueue([{ type: "text", text: "one" }]);
        result.current.enqueue([
          { type: "text", text: "two" },
          {
            type: "image",
            source: { type: "url", value: "https://x/y.png" },
          },
        ]);
      });

      isRunning = false;
      rerender({ isRunning });

      expect(onDrain).toHaveBeenCalledTimes(1);
      expect(onDrain).toHaveBeenCalledWith([
        { type: "text", text: "one\n\ntwo" },
        {
          type: "image",
          source: { type: "url", value: "https://x/y.png" },
        },
      ]);
      expect(result.current.items).toHaveLength(0);
    });
  });

  describe("dispatch: manual", () => {
    it("does not drain automatically on idle transition", () => {
      const onDrain = vi.fn();
      let isRunning = true;
      const { result, rerender } = renderHook(
        ({ isRunning }) =>
          useMessageQueue({
            enabled: true,
            dispatch: "manual",
            isRunning,
            onDrain,
          }),
        { initialProps: { isRunning } },
      );

      act(() => result.current.enqueue(textContent("waiting")));

      isRunning = false;
      rerender({ isRunning });

      expect(onDrain).not.toHaveBeenCalled();
      expect(result.current.items).toHaveLength(1);
    });

    it("sendNow pops the given item and calls onDrain", () => {
      const onDrain = vi.fn();
      const { result } = renderHook(() =>
        useMessageQueue({
          enabled: true,
          dispatch: "manual",
          isRunning: false,
          onDrain,
        }),
      );

      act(() => {
        result.current.enqueue(textContent("a"));
        result.current.enqueue(textContent("b"));
      });

      const firstId = result.current.items[0].id;
      act(() => result.current.sendNow(firstId));

      expect(onDrain).toHaveBeenCalledTimes(1);
      expect(onDrain).toHaveBeenCalledWith(textContent("a"));
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].content).toEqual(textContent("b"));
    });
  });

  describe("clear", () => {
    it("empties the queue", () => {
      const { result } = renderHook(() =>
        useMessageQueue({
          enabled: true,
          dispatch: "sequential",
          isRunning: true,
          onDrain: vi.fn(),
        }),
      );

      act(() => {
        result.current.enqueue(textContent("a"));
        result.current.enqueue(textContent("b"));
      });

      act(() => result.current.clear());
      expect(result.current.items).toHaveLength(0);
    });
  });
});
