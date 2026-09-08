import { describe, expect, it } from "vitest";
import {
  FORWARDED_TO_CLIENT,
  isForwardedToClientPlaceholder,
  normalizeToolResultContent,
} from "../core/tool-result-content";

describe("tool result content", () => {
  it.each([
    FORWARDED_TO_CLIENT,
    ` ${FORWARDED_TO_CLIENT} `,
    ["Forwarded", { text: " to client " }],
    { text: FORWARDED_TO_CLIENT },
  ])("recognizes forwarded-to-client content: %j", (content) => {
    expect(normalizeToolResultContent(content)).toBe(FORWARDED_TO_CLIENT);
    expect(isForwardedToClientPlaceholder(content)).toBe(true);
  });

  it.each(["", "other", [], ["", { text: "" }], { text: "" }, 42, null])(
    "does not recognize real or empty content: %j",
    (content) => {
      expect(isForwardedToClientPlaceholder(content)).toBe(false);
    },
  );
});
