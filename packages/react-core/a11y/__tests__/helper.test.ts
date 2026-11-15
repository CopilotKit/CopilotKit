import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkDOM,
  observeClicks,
  expectNoAxeViolations,
  classifyKnown,
} from "../../../a11y-test-kit/src/index";

import { audit } from "../../../a11y-test-kit/src/report";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe("framework-neutral accessibility helper", () => {
  it("detects click handlers, missing names, broken IDREFs and hidden focus", () => {
    const stop = observeClicks();
    document.body.innerHTML =
      '<div><img alt="Photo"><button aria-controls="missing"></button><div aria-hidden="true"><input aria-label="Hidden"></div></div>';
    document.querySelector("img")!.addEventListener("click", () => {});
    const findings = checkDOM(document.body, stop());
    expect(findings.map((x) => x.rule)).toEqual(
      expect.arrayContaining([
        "click-focusable",
        "click-role",
        "interactive-name",
        "id-reference",
        "hidden-focus",
      ]),
    );
  });
  it("accepts native roles and computed label names, and programmatic focus", () => {
    document.body.innerHTML =
      '<label for="x">Name</label><input id="x"><button><img alt="Save"></button><span id="name" hidden>Open</span><div role="button" tabindex="-1" aria-labelledby="name"></div>';
    expect(checkDOM(document.body)).toEqual([]);
  });
  it("checks direct click listeners on ancestors as well as their clickable descendants", () => {
    const stop = observeClicks();
    document.body.innerHTML = "<div><button>Child</button></div>";
    document.querySelector("div")!.addEventListener("click", () => {});
    document.querySelector("button")!.addEventListener("click", () => {});
    expect(checkDOM(document.body, stop()).map((x) => x.rule)).toEqual([
      "click-focusable",
      "click-role",
    ]);
  });
  it("ignores controls hidden by ancestor CSS and hidden inputs with tabindex", () => {
    document.body.innerHTML =
      '<div style="display:none"><button></button></div><div aria-hidden="true"><input type="hidden" tabindex="0"></div>';
    expect(checkDOM(document.body)).toEqual([]);
  });
  it("warns and resolves for an unbaselined accessibility violation without changing the baseline", async () => {
    vi.stubEnv("A11Y_UPDATE_BASELINE", "");
    vi.stubEnv("A11Y_REPORT_DIR", "");
    const warn = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    document.body.innerHTML = "<button></button>";
    await expect(
      audit("react", "unbaselined-test", new Set()),
    ).resolves.toMatchObject({
      warnings: { known: 0, new: 2, missingBaseline: true },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "[a11y warning] react/unbaselined-test: 0 known, 2 new",
      ),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no reviewed baseline"),
    );
  });
  it("warns without failing on axe findings and classifies reviewed occurrences", async () => {
    document.body.innerHTML = "<button></button>";
    const warn = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const findings = await expectNoAxeViolations(document.body);
    expect(findings.map((x) => x.rule)).toContain("button-name");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[a11y warning] axe"),
    );
    expect(classifyKnown(["known", "new", "known"], ["known"])).toEqual({
      known: ["known"],
      new: ["new", "known"],
    });
    expect(classifyKnown([], ["fixed"])).toEqual({ known: [], new: [] });
  });
});
