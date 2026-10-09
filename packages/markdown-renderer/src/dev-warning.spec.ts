import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetUnsupportedRichSyntaxWarning,
  warnUnsupportedRichSyntaxOnce,
} from "./dev-warning";

describe("warnUnsupportedRichSyntaxOnce", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  const prevNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    __resetUnsupportedRichSyntaxWarning();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    warn.mockRestore();
    process.env.NODE_ENV = prevNodeEnv;
  });

  it("warns on a language-tagged fenced code block", () => {
    warnUnsupportedRichSyntaxOnce("here:\n```ts\nconst x = 1;\n```");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("syntax highlighting");
    expect(warn.mock.calls[0][0]).toContain("migrate/markdown-renderer");
  });

  it("warns on block math", () => {
    warnUnsupportedRichSyntaxOnce("$$ E = mc^2 $$");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("math");
  });

  it("does not warn on plain prose, GFM, or a fence without a language", () => {
    warnUnsupportedRichSyntaxOnce(
      "# Title\n\n- a\n- b\n\n`inline` and a price of $5\n\n```\nplain\n```",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns at most once across calls", () => {
    warnUnsupportedRichSyntaxOnce("```js\n1\n```");
    warnUnsupportedRichSyntaxOnce("$$x$$");
    warnUnsupportedRichSyntaxOnce("```py\n2\n```");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("is a no-op in production", () => {
    process.env.NODE_ENV = "production";
    warnUnsupportedRichSyntaxOnce("```ts\nconst x = 1;\n```");
    expect(warn).not.toHaveBeenCalled();
  });
});
