import { describe, expect, it } from "vitest";
import {
  ensureHead,
  extractCompleteStyles,
  injectCssIntoHtml,
  processPartialHtml,
} from "../process-partial-html";

describe("Open Generative UI partial HTML processing", () => {
  it("keeps complete style tags in the preview head and strips incomplete tags", () => {
    const partial =
      '<style>.card { color: red; }</style><div class="card">Revenue<style>.broken';

    expect(extractCompleteStyles(partial)).toBe(
      "<style>.card { color: red; }</style>",
    );
    expect(processPartialHtml(partial)).toBe('<div class="card">Revenue');
  });

  it("injects generated CSS into existing or synthesized head tags", () => {
    expect(
      injectCssIntoHtml(
        "<html><head><title>Demo</title></head><body>Body</body></html>",
        ".card { color: red; }",
      ),
    ).toContain("<style>.card { color: red; }</style></head>");

    expect(
      injectCssIntoHtml("<body>Body</body>", ".metric { color: blue; }"),
    ).toContain("<head><style>.metric { color: blue; }</style></head>");
  });

  it("ensures sandbox content has a head element", () => {
    expect(ensureHead("<body>Body</body>")).toBe(
      "<head></head><body>Body</body>",
    );
    expect(ensureHead("<html><head></head><body>Body</body></html>")).toBe(
      "<html><head></head><body>Body</body></html>",
    );
  });
});
