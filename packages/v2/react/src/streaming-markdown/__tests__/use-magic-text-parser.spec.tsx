// Derived from hashbrown/packages/react/src/hooks/use-magic-text-parser.tsx
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMagicTextParser } from "../use-magic-text-parser";
import type { HeadingBlock, ParagraphBlock, CodeFenceBlock, TableBlock } from "@copilotkitnext/core";

describe("useMagicTextParser", () => {
  it("starts with empty blocks", () => {
    const { result } = renderHook(() => useMagicTextParser());
    expect(result.current.blocks).toHaveLength(0);
    expect(result.current.consumed).toBe(0);
  });

  it("parses a heading via feed()", () => {
    const { result } = renderHook(() => useMagicTextParser());

    act(() => {
      result.current.feed("# Hello\n");
    });

    expect(result.current.blocks).toHaveLength(1);
    const heading = result.current.blocks[0] as HeadingBlock;
    expect(heading.type).toBe("heading");
    expect(heading.content).toBe("Hello");
  });

  it("accumulates blocks across multiple feed() calls", () => {
    const { result } = renderHook(() => useMagicTextParser());

    act(() => {
      result.current.feed("# Title\n\n");
    });

    act(() => {
      result.current.feed("Some text\n");
    });

    expect(result.current.blocks.length).toBeGreaterThanOrEqual(2);
    expect(result.current.blocks[0].type).toBe("heading");
    expect(result.current.blocks[1].type).toBe("paragraph");
  });

  it("handles partial content via streaming feed()", () => {
    const { result } = renderHook(() => useMagicTextParser());

    act(() => {
      result.current.feed("# Hel");
    });

    // Even partial content should show up (via internal finalization for view)
    expect(result.current.blocks).toHaveLength(1);
    const heading = result.current.blocks[0] as HeadingBlock;
    expect(heading.content).toBe("Hel");

    act(() => {
      result.current.feed("lo World\n");
    });

    expect(result.current.blocks).toHaveLength(1);
    expect((result.current.blocks[0] as HeadingBlock).content).toBe(
      "Hello World",
    );
  });

  it("feedFullText only parses new content", () => {
    const { result } = renderHook(() => useMagicTextParser());

    act(() => {
      result.current.feedFullText("# Hello\n");
    });

    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.consumed).toBe(8); // "# Hello\n" = 8 chars

    act(() => {
      result.current.feedFullText("# Hello\nWorld\n");
    });

    // Should have parsed only the new "World\n" part
    expect(result.current.consumed).toBe(14); // "# Hello\nWorld\n" = 14 chars
  });

  it("finalize() flushes remaining buffer", () => {
    const { result } = renderHook(() => useMagicTextParser());

    act(() => {
      result.current.feed("Hello world");
    });

    // Content is visible due to internal view finalization
    expect(result.current.blocks).toHaveLength(1);

    act(() => {
      result.current.finalize();
    });

    expect(result.current.blocks).toHaveLength(1);
    expect((result.current.blocks[0] as ParagraphBlock).content).toBe(
      "Hello world",
    );
  });

  it("reset() clears all state", () => {
    const { result } = renderHook(() => useMagicTextParser());

    act(() => {
      result.current.feed("# Hello\n");
    });

    expect(result.current.blocks).toHaveLength(1);

    act(() => {
      result.current.reset();
    });

    expect(result.current.blocks).toHaveLength(0);
    expect(result.current.consumed).toBe(0);
  });

  it("handles table streaming", () => {
    const { result } = renderHook(() => useMagicTextParser());

    act(() => {
      result.current.feed("| A | B |\n");
    });

    act(() => {
      result.current.feed("| --- | --- |\n");
    });

    expect(result.current.blocks[0].type).toBe("table");

    act(() => {
      result.current.feed("| 1 | 2 |\n");
    });

    const table = result.current.blocks[0] as TableBlock;
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][0].content).toBe("1");
  });

  it("handles code fence streaming", () => {
    const { result } = renderHook(() => useMagicTextParser());

    act(() => {
      result.current.feed("```js\n");
    });

    expect(result.current.blocks[0].type).toBe("code_fence");
    expect((result.current.blocks[0] as CodeFenceBlock).language).toBe("js");

    act(() => {
      result.current.feed("const x = 1;\n```\n");
    });

    const fence = result.current.blocks[0] as CodeFenceBlock;
    expect(fence.content).toBe("const x = 1;");
    expect(fence.closed).toBe(true);
  });
});
