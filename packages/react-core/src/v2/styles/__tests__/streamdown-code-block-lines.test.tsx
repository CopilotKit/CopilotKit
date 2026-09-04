/**
 * #3330: fenced code blocks collapsed onto a single line in the packaged UI.
 *
 * streamdown renders one <span> per source line inside
 * `pre[data-streamdown="code-block-body"] > code`, and the line break comes
 * entirely from the raw Tailwind utility `block` on that span — the <pre> text
 * itself holds no newline characters. CopilotKit builds Tailwind with
 * `prefix(cpk)`, so `.block` never reaches the packaged CSS and every line ran
 * inline. globals.css therefore scopes the display rule structurally, because
 * the line spans carry no `data-streamdown` attribute:
 * `[data-streamdown="code-block-body"] > code > span { @apply cpk:block }`.
 *
 * A source-string test (streamdown-styles.test.ts) guards that the selector
 * exists. This DOM test guards the OTHER half: that streamdown still renders the
 * structure that selector assumes. If streamdown changes its code-block markup
 * (adds a data-streamdown attribute to the lines, renests them, or starts
 * emitting real newlines), this fails — signalling the scoped CSS must be
 * revisited.
 */
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Streamdown } from "streamdown";

const CODE_LINES = [
  "function greet(name) {",
  "  const msg = `hi ${name}`;",
  "  return msg;",
  "}",
];
const CODE_MARKDOWN = ["```js", ...CODE_LINES, "```", ""].join("\n");

describe("Streamdown code block lines DOM (#3330)", () => {
  it("renders one line span per source line, matching the scoped selector", async () => {
    const { container } = render(
      <div data-copilotkit="">
        <Streamdown>{CODE_MARKDOWN}</Streamdown>
      </div>,
    );

    // Highlighting is async: the first paint is a loading skeleton.
    await waitFor(
      () => {
        expect(
          container.querySelector('pre[data-streamdown="code-block-body"]'),
        ).not.toBeNull();
      },
      { timeout: 15000 },
    );

    const body = container.querySelector<HTMLElement>(
      'pre[data-streamdown="code-block-body"]',
    )!;

    // One span per source line, directly under <code> — exactly what
    // `> code > span` scopes.
    const lineSpans = body.querySelectorAll(":scope > code > span");
    expect(lineSpans.length).toBeGreaterThanOrEqual(CODE_LINES.length);
    CODE_LINES.forEach((line, index) => {
      expect(lineSpans[index]!.textContent).toBe(line);
    });

    // The lines have no data-streamdown attribute (the reason the CSS targets
    // them structurally) and carry the unprefixed `block` utility, which the
    // cpk-prefixed build never emits.
    expect(lineSpans[0]!.getAttribute("data-streamdown")).toBeNull();
    expect(lineSpans[0]!.classList.contains("block")).toBe(true);

    // There is no newline anywhere in the code body, so `white-space: pre` on
    // the <pre> cannot produce the line breaks on its own.
    expect(body.textContent).not.toContain("\n");
  }, 20000);
});
