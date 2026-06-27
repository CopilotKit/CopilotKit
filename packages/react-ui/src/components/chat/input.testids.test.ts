import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Verifies stable `data-testid` markers exist on the CopilotChat input controls
 * so e2e tests (e.g. Playwright) can deterministically locate the textarea and
 * send button on the default `<CopilotChat>` surface. See GitHub issue #4215.
 *
 * The selector names mirror the V2 components in
 * `@copilotkit/react-core` (`copilot-chat-textarea`, `copilot-send-button`) so a
 * test recipe written against V2 carries over to the default surface unchanged.
 *
 * This runs in the package's node test environment (no DOM), so it asserts the
 * wiring at the source level. Crucially it checks BOTH that `Input.tsx` passes
 * the testid AND that `Textarea.tsx` forwards it onto the rendered `<textarea>`:
 * `AutoResizingTextarea` destructures a fixed prop set with no `{...rest}`
 * spread, so a testid passed from `Input.tsx` is silently dropped unless the
 * inner component explicitly declares and applies it.
 */

const inputPath = resolve(__dirname, "Input.tsx");
const textareaPath = resolve(__dirname, "Textarea.tsx");

const inputSrc = readFileSync(inputPath, "utf-8");
const textareaSrc = readFileSync(textareaPath, "utf-8");

describe("CopilotChat input stable testids", () => {
  it("Input passes the copilot-chat-textarea testid to the textarea", () => {
    expect(inputSrc).toMatch(/data-testid="copilot-chat-textarea"/);
  });

  it("Input puts the copilot-send-button testid on the send control", () => {
    expect(inputSrc).toMatch(/data-testid="copilot-send-button"/);
  });

  it("Input preserves the legacy data-test-id for back-compat", () => {
    expect(inputSrc).toMatch(/data-test-id=/);
    expect(inputSrc).toMatch(/copilot-chat-ready/);
  });

  it("Textarea declares and forwards data-testid onto the inner textarea", () => {
    // Declared on the props interface...
    expect(textareaSrc).toMatch(/"data-testid"\?: string/);
    // ...and actually applied to the rendered <textarea> (the dropped-prop guard).
    expect(textareaSrc).toMatch(/data-testid=\{dataTestId\}/);
  });
});
