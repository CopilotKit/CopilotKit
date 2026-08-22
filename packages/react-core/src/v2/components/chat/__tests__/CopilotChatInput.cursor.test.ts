import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Regression test for GitHub issue #6167.
 *
 * In the v2 CopilotChatInput the `adjustTextareaHeight` callback that resizes
 * the textarea sets `textarea.style.height = "auto"`, triggering a browser
 * reflow. In Chromium this reflow resets `selectionStart`/`selectionEnd` to
 * the end of the text, so typing a character while the cursor is mid-word
 * causes it to jump to the end.
 *
 * The fix reads the cursor position before the height manipulation and calls
 * `setSelectionRange()` to restore it afterwards, but only when the textarea
 * is the active element (to avoid side-effects when it has no focus).
 *
 * jsdom does not simulate Chromium reflow behaviour, so a rendering-level
 * test would pass with or without the fix. These source-level assertions
 * verify the save/restore pattern exists and will fail if it is accidentally
 * removed.
 */

const src = readFileSync(
  resolve(__dirname, "../CopilotChatInput.tsx"),
  "utf-8",
);

describe("CopilotChatInput adjustTextareaHeight cursor-position fix (#6167)", () => {
  it("captures selectionStart/End immediately before the height reset", () => {
    // The cursor position must be saved BEFORE `style.height = "auto"` so
    // that the pre-reflow value is available to restore afterwards.
    expect(src).toMatch(
      /const\s*\{\s*selectionStart[\s\S]{0,200}textarea\.style\.height\s*=\s*"auto"/,
    );
  });

  it("calls setSelectionRange after the final height assignment", () => {
    // The restore call must come AFTER the last height assignment so that the
    // final rendered height is already in place when we reposition the cursor.
    // In v2 the else-branch (`${scrollHeight}px`) is the last assignment before
    // the restore, so the pattern anchors there.
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
