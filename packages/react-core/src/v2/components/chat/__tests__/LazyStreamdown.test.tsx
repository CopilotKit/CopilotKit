import { render, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LazyStreamdown } from "../LazyStreamdown";

describe("LazyStreamdown", () => {
  it("renders markdown once the lazily-loaded chunk resolves", async () => {
    const { container } = render(
      <LazyStreamdown>{"# Heading\n\nbody text"}</LazyStreamdown>,
    );

    // Streamdown is behind React.lazy + Suspense. Once the chunk resolves it
    // transforms the markdown into an <h1> (streamdown tags it
    // data-streamdown="heading-1") that the raw <pre> fallback never produces,
    // proving the full lazy + Suspense pipeline ran.
    await waitFor(
      () => {
        const h1 = container.querySelector('h1[data-streamdown="heading-1"]');
        expect(h1).not.toBeNull();
        expect(h1?.textContent).toBe("Heading");
      },
      { timeout: 5000 },
    );
  });

  it("renders inline single-$ math via KaTeX (singleDollarTextMath regression guard)", async () => {
    const { container } = render(
      <LazyStreamdown>{"Euler: $e^{i\\pi} + 1 = 0$ done"}</LazyStreamdown>,
    );
    // The @streamdown/math plugin is configured with singleDollarTextMath:true
    // (v1 parity). If that regresses, inline `$...$` renders as literal text and
    // no .katex element appears.
    await waitFor(
      () => expect(container.querySelector(".katex")).not.toBeNull(),
      { timeout: 5000 },
    );
    expect(container.textContent).not.toContain("$e^{i\\pi}");
  });

  it("shows the streamed text (via the <pre> fallback) before/while resolving", async () => {
    const { container } = render(
      <LazyStreamdown>plain streamed text</LazyStreamdown>,
    );
    // Whether the fallback <pre> is showing or streamdown has resolved, the
    // already-streamed text must always be visible to the user (no blank gap).
    expect(container.textContent).toContain("plain streamed text");
    await waitFor(() =>
      expect(container.textContent).toContain("plain streamed text"),
    );
  });
});
