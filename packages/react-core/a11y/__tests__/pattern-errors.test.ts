import { afterEach, describe, expect, it, vi } from "vitest";
import { expectPattern } from "../../../a11y-test-kit/src/pattern";

// The wrapper snapshots IDs before invoking the real checker. Inject at the
// checker's first DOM query, then let the wrapper's second snapshot run normally.
function rejectFromChecker(error: unknown) {
  const query = document.body.querySelectorAll.bind(document.body);
  vi.spyOn(document.body, "querySelectorAll")
    .mockImplementationOnce(query)
    .mockImplementationOnce(() => {
      throw error;
    });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("pattern checker error boundary", () => {
  it("warns for a complete finding report and normalizes generated IDs", async () => {
    document.body.innerHTML = '<div id="generated-dialog" role="dialog"></div>';
    rejectFromChecker(
      new Error(
        "checkPattern found 1 problem with the dialog pattern:\n- div#generated-dialog: has no accessible name.",
      ),
    );
    const warning = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await expect(expectPattern(document.body, "dialog")).resolves.toEqual([
      {
        rule: "dialog",
        target: ":scope",
        detail: "div#<id:1>: has no accessible name.",
      },
    ]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("[a11y warning] pattern/dialog"),
    );
  });

  it.each([
    ["unexpected crash", new Error("Unexpected checker crash")],
    ["non-Error rejection", "Unexpected checker rejection"],
    ["null rejection", null],
  ])("propagates the original %s", async (_label, error) => {
    rejectFromChecker(error);
    await expect(expectPattern(document.body, "dialog")).rejects.toBe(error);
  });

  it.each([
    [
      "missing findings",
      "checkPattern found 1 problem with the dialog pattern:",
    ],
    [
      "changed bullet format",
      "checkPattern found 1 problem with the dialog pattern:\n* Missing name",
    ],
    [
      "mismatched count",
      "checkPattern found 2 problems with the dialog pattern:\n- Missing name",
    ],
    [
      "empty finding",
      "checkPattern found 1 problem with the dialog pattern:\n- ",
    ],
    [
      "whitespace-only finding",
      "checkPattern found 1 problem with the dialog pattern:\n-   ",
    ],
    [
      "blank line",
      "checkPattern found 1 problem with the dialog pattern:\n- Missing name\n",
    ],
    [
      "changed header",
      "checkPattern found 1 problem with the dialog pattern: checker crashed\n- Missing name",
    ],
    [
      "unknown pattern",
      "checkPattern found 1 problem with the menu pattern:\n- Missing name",
    ],
    [
      "incorrect count grammar",
      "checkPattern found 1 problems with the dialog pattern:\n- Missing name",
    ],
    [
      "unexpected extra prose",
      "checkPattern found 1 problem with the dialog pattern:\n- Missing name\nChecker crashed",
    ],
    [
      "wrong pattern",
      "checkPattern found 1 problem with the tabs pattern:\n- Missing name",
    ],
    [
      "zero findings in an error",
      "checkPattern found 0 problems with the dialog pattern:\n- Missing name",
    ],
  ])("rejects a malformed report with %s", async (_label, message) => {
    const error = new Error(message);
    rejectFromChecker(error);
    await expect(expectPattern(document.body, "dialog")).rejects.toBe(error);
  });
});
