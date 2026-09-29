import { afterEach, describe, expect, it, vi } from "vitest";
import { readChangedText, readControlText } from "./text";

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

  it("reads the initial state independently of native change events", () => {
    const element = field(
      '<textarea aria-label="Review note">Move the supplier dinner to Friday.</textarea>',
    );
    expect(readControlText(element)).toEqual({
      value: "Move the supplier dinner to Friday.",
    });
    element.value = "Move the supplier dinner to Monday.";
    expect(readControlText(element)).toEqual({
      value: "Move the supplier dinner to Monday.",
    });
  });

  it.each([
    ["number", "42"],
    ["range", "25"],
    ["date", "2026-09-27"],
    ["time", "13:45"],
    ["datetime-local", "2026-09-27T13:45"],
    ["month", "2026-09"],
    ["week", "2026-W39"],
  ])("reads ordinary native %s task values", (type, value) => {
    const element = field(
      `<input type="${type}" aria-label="Task setting" value="${value}">`,
    );
    expect(readControlText(element)).toEqual({ value });
  });

  it.each(["Birthday", "Date of birth", "DOB"])(
    "omits personal dates labelled %s before reading them",
    (label) => {
      const element = field(
        `<input type="date" aria-label="${label}" value="1990-01-01">`,
      );
      const valueRead = vi.spyOn(element, "value", "get");
      expect(readControlText(element)).toEqual({ omitted: "sensitive-field" });
      expect(valueRead).not.toHaveBeenCalled();
    },
  );

  it("does not treat long numeric account identifiers as ordinary task quantities", () => {
    const element = field(
      '<input type="number" aria-label="Reference" value="4242424242424242">',
    );
    expect(readControlText(element)).toEqual({ omitted: "sensitive-content" });
  });

  it("reads visible editable text and retains paragraph boundaries", () => {
    document.body.innerHTML =
      '<div contenteditable="true" aria-label="Dispatch note"><p>Use the loading dock.</p><p>Ask for a receipt.</p></div>';
    expect(readControlText(document.body.firstElementChild!)).toEqual({
      value: "Use the loading dock.\nAsk for a receipt.",
    });
  });

  it.each(["data-private", "hidden", "data-copilotkit"])(
    "omits the whole editor if a %s descendant makes its value incomplete",
    (attribute) => {
      document.body.innerHTML = `<div contenteditable="true" aria-label="Dispatch note">Use the loading dock.<span ${attribute}>PRIVATE_CANARY</span></div>`;
      const secret = document.querySelector("span")!.firstChild! as Text;
      const read = vi.spyOn(secret, "data", "get");
      expect(readControlText(document.body.firstElementChild!)).toEqual({
        omitted: "sensitive-field",
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("uses the same sensitive-field and sensitive-content filters for custom editors", () => {
    document.body.innerHTML =
      '<div contenteditable="true" aria-label="Home address">PRIVATE_CANARY</div>';
    expect(readControlText(document.body.firstElementChild!)).toEqual({
      omitted: "sensitive-field",
    });
    document.body.innerHTML =
      '<div contenteditable="plaintext-only" aria-label="Dispatch note">Contact reviewer@example.test</div>';
    expect(readControlText(document.body.firstElementChild!)).toEqual({
      omitted: "sensitive-content",
    });
  });

  it("bounds editor traversal and rejects oversized content without a misleading prefix", () => {
    document.body.innerHTML = `<div contenteditable="true">${"<span>a</span>".repeat(70)}</div>`;
    expect(readControlText(document.body.firstElementChild!)).toEqual({
      omitted: "size-limit",
    });
    document.body.innerHTML = `<div contenteditable="true">${"x".repeat(1025)}</div>`;
    expect(readControlText(document.body.firstElementChild!)).toEqual({
      omitted: "size-limit",
    });
  });
});
