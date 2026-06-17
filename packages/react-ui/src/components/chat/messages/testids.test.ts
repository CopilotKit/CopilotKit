import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Verifies stable `data-testid` markers exist on the error banner and loading
 * indicator surfaces so e2e tests can deterministically distinguish "errored
 * out" vs "still loading" states. Without these, e2e probes hit ~30-60s
 * timeouts instead of failing fast.
 */

const errorMessagePath = resolve(__dirname, "ErrorMessage.tsx");
const assistantMessagePath = resolve(__dirname, "AssistantMessage.tsx");
const messagesPath = resolve(__dirname, "../Messages.tsx");

const errorMessageSrc = readFileSync(errorMessagePath, "utf-8");
const assistantMessageSrc = readFileSync(assistantMessagePath, "utf-8");
const messagesSrc = readFileSync(messagesPath, "utf-8");

describe("react-ui stable testids", () => {
  it("ErrorMessage renders the copilot-error-banner testid on its root", () => {
    expect(errorMessageSrc).toMatch(/data-testid="copilot-error-banner"/);
  });

  it("Messages LoadingIcon renders the copilot-loading-cursor testid", () => {
    expect(messagesSrc).toMatch(/data-testid="copilot-loading-cursor"/);
  });

  it("AssistantMessage LoadingIcon renders the copilot-loading-cursor testid", () => {
    expect(assistantMessageSrc).toMatch(/data-testid="copilot-loading-cursor"/);
  });
});
