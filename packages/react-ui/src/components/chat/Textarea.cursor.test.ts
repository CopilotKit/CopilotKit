import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Regression test for GitHub issue #6167.
 *
 * In expanded (narrow) mode the `AutoResizingTextarea` useEffect that resizes
 * the element sets `textarea.style.height = "auto"`, triggering a browser
 * reflow. In Chromium this reflow resets `selectionStart`/`selectionEnd` to
 * the end of the text, so typing a character while the cursor is mid-word
 * causes it to jump to the end.
 *
 * The fix reads the cursor position before the height manipulation and calls
 * `setSelectionRange()` to restore it afterwards, but only when the textarea
 * is the active element (to avoid side-effects when it has no focus).
 *
 * These source-level assertions verify the fix exists and will fail if the
 * save/restore pattern is accidentally removed.
 */

const src = readFileSync(resolve(__dirname, "Textarea.tsx"), "utf-8");

describe("AutoResizingTextarea cursor-position fix (#6167)", () => {
  it("captures selectionStart/End immediately before the height reset", () => {
    // The cursor position must be saved BEFORE `style.height = "auto"` so
    // that the pre-reflow value is available to restore afterwards.
    // This pattern verifies the destructuring happens first, then the reset.
    expect(src).toMatch(
      /const\s*\{\s*selectionStart[\s\S]{0,200}textarea\.style\.height\s*=\s*"auto"/,
    );
  });

  it("calls setSelectionRange after the final height assignment", () => {
    // The restore call must come AFTER both height assignments so that the
    // final rendered height is already in place when we reposition the cursor.
    // Pattern: the last `textarea.style.height = ...` line is followed by
    // the `setSelectionRange` call somewhere after it.
    expect(src).toMatch(
      /textarea\.style\.height\s*=\s*`[^`]+`[\s\S]{0,400}setSelectionRange/,
    );
  });

  it("guards the setSelectionRange call with a focus check", () => {
    // Calling setSelectionRange on an unfocused element can steal focus in
    // some browsers. The guard `document.activeElement === textarea` prevents
    // that for background textareas.
    expect(src).toMatch(/document\.activeElement\s*===\s*textarea/);
  });
});
