import { afterEach, describe, expect, it, vi } from "vitest";
import { readChangedText } from "./text";

function field(markup = '<textarea aria-label="Review note"></textarea>') {
  document.body.innerHTML = markup;
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input,textarea",
  )!;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("changed task text", () => {
  it.each([
    "Please reject this request until the missing receipt is attached.",
    "2026 budget: $84.50\nAsk for a receipt before approval.",
    "Line one\n\tIndented follow-up",
    "Rotate the token and phone the reviewer before continuing.",
    "",
  ])("retains the exact useful text: %j", (value) => {
    const element = field();
    element.value = value;
    expect(readChangedText(element)).toEqual({ value });
  });

  it.each(["text", "search"])("supports native %s inputs", (type) => {
    const element = field(`<input type="${type}" aria-label="Task note">`);
    element.value = "Require review";
    expect(readChangedText(element)).toEqual({ value: "Require review" });
  });

  it.each([
    '<input name="taskName" aria-label="Task name">',
    '<textarea id="note-12345678" aria-label="Review note"></textarea>',
  ])("does not mistake task metadata for personal content: %s", (markup) => {
    const element = field(markup);
    element.value = "Require review";
    expect(readChangedText(element)).toEqual({ value: "Require review" });
  });

  it.each([
    '<input type="number">',
    '<input type="password">',
    "<textarea data-private></textarea>",
    "<div data-sensitive><textarea></textarea></div>",
    "<div hidden><textarea></textarea></div>",
    '<div style="display:none"><textarea></textarea></div>',
    "<div data-copilotkit><textarea></textarea></div>",
    '<textarea autocomplete="current-password"></textarea>',
  ])("does not read excluded control values: %s", (markup) => {
    const element = field(markup);
    const valueRead = vi.spyOn(element, "value", "get");
    expect(readChangedText(element)).toBeUndefined();
    expect(valueRead).not.toHaveBeenCalled();
  });

  it.each([
    '<textarea aria-label="Full name"></textarea>',
    '<textarea aria-label="Home address"></textarea>',
    '<textarea autocomplete="username"></textarea>',
    '<label for="field">Contact phone</label><textarea id="field"></textarea>',
    '<span id="field-label">API key</span><textarea aria-labelledby="field-label"></textarea>',
    '<textarea title="Social security number"></textarea>',
  ])("omits sensitive field hints before reading values: %s", (markup) => {
    const element = field(markup);
    const valueRead = vi.spyOn(element, "value", "get");
    expect(readChangedText(element)).toEqual({ omitted: "sensitive-field" });
    expect(valueRead).not.toHaveBeenCalled();
  });

  it("does not read a private or SDK-owned shadow descendant", () => {
    for (const attribute of ["data-private", "data-copilotkit"]) {
      const host = document.createElement("div");
      host.setAttribute(attribute, "");
      document.body.append(host);
      const textarea = document.createElement("textarea");
      host.attachShadow({ mode: "open" }).append(textarea);
      const valueRead = vi.spyOn(textarea, "value", "get");
      expect(readChangedText(textarea)).toBeUndefined();
      expect(valueRead).not.toHaveBeenCalled();
    }
  });

  it.each([
    "Contact alice@example.com before approving.",
    "See https://example.com/private?key=hidden",
    "Call +1 (415) 555-0123",
    "Card: 4242 4242 4242 4242",
    "SSN: 123-45-6789",
    "Keep this note\npassword = not-for-learning",
    "Authorization: Bearer abcdefghijklmnop",
    "api_key: abcdefghijklmnop",
    "Call ４１５５５５０１２３",
    "\u0000".repeat(1024),
    "Unexpected\u001b[31m escape sequence",
  ])("omits the whole sensitive value: %j", (value) => {
    const element = field();
    element.value = value;
    expect(readChangedText(element)).toEqual({ omitted: "sensitive-content" });
  });

  it("rejects overlength text instead of hiding a sensitive suffix", () => {
    const element = field();
    element.value = "a".repeat(1024) + " alice@example.com";
    expect(readChangedText(element)).toEqual({ omitted: "size-limit" });
  });

  it("enforces both UTF-16 and encoded byte limits", () => {
    const element = field();
    element.value = "a".repeat(1024);
    expect(readChangedText(element)).toEqual({ value: element.value });
    element.value = "界".repeat(683);
    expect(readChangedText(element)).toEqual({ omitted: "size-limit" });
  });

  it("does not infer values from contenteditable markup", () => {
    const element = document.createElement("div");
    element.contentEditable = "true";
    element.textContent = "Unsaved draft";
    document.body.append(element);
    expect(readChangedText(element)).toBeUndefined();
  });
});
