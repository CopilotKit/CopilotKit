import { render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { StreamingMarkdownRenderer } from "./streaming-markdown-renderer";

// React warns about an invalid DOM property only once per module instance, so
// this check lives in its own file: an earlier caret render in a shared file
// would swallow the warning and hide a regression.

afterEach(() => {
  vi.restoreAllMocks();
});

test("the default caret renders its class through className without a React DOM warning", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  const { container } = render(
    <StreamingMarkdownRenderer caret options={{ segmenter: false }}>
      {"streaming paragraph"}
    </StreamingMarkdownRenderer>,
  );

  const caret = container.querySelector("[data-streaming-markdown-caret]");
  expect(caret?.getAttribute("class")).toBe("cpk-streaming-markdown-caret");

  const invalidPropertyWarnings = consoleError.mock.calls.filter((args) =>
    String(args[0]).includes("Invalid DOM property"),
  );
  expect(invalidPropertyWarnings).toEqual([]);
});
