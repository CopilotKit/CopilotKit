import { afterEach, describe, expect, it, vi } from "vitest";
import { installInputCapture } from "../inputs";
import { createRedactor } from "../redact";

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("input capture", () => {
  it("captures edited text, checkbox state, and selected values, and redacts passwords", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<input id="name"><input id="password" type="password" value="secret"><input id="check" type="checkbox"><textarea id="notes"></textarea><select id="choice" multiple><option value="a" selected>A</option><option value="b" selected>B</option></select><div id="editor" contenteditable="true">Rich text</div>`;
    const events: Record<string, unknown>[] = [];
    uninstall = installInputCapture({
      emit: (name, value) => events.push({ name, ...value }),
      isTrusted: () => true,
    });
    for (const id of [
      "name",
      "password",
      "check",
      "notes",
      "choice",
      "editor",
    ]) {
      const element = document.getElementById(id)!;
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      )
        element.value = `synthetic-${id}`;
      if (element instanceof HTMLInputElement && element.type === "checkbox")
        element.checked = true;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    vi.advanceTimersByTime(300);
    expect(events).toHaveLength(6);
    expect(events[0]).toMatchObject({
      name: "input",
      eventType: "input",
      url: location.href,
      target: { value: "synthetic-name", attributes: { id: "name" } },
    });
    expect(events[1]).toMatchObject({
      target: { value: "[redacted]", attributes: { value: "[redacted]" } },
    });
    expect(JSON.stringify(events[1])).not.toContain("secret");
    expect(events[2]).toMatchObject({ target: { checked: true } });
    expect(events[3]).toMatchObject({ target: { value: "synthetic-notes" } });
    expect(events[4]).toMatchObject({ target: { selectedValues: ["a", "b"] } });
    expect(events[5]).toMatchObject({ target: { value: "Rich text" } });
    uninstall();
    document
      .getElementById("name")!
      .dispatchEvent(new Event("change", { bubbles: true }));
    expect(events).toHaveLength(6);
  });

  it("ignores synthetic edits by default and honors explicit opt-outs", () => {
    document.body.innerHTML = `<input id="field" value="synthetic" data-copilotkit-ignore>`;
    // Assert externally because capture deliberately catches observer exceptions.
    const events: unknown[] = [];
    uninstall = installInputCapture({ emit: (...args) => events.push(args) });
    document
      .getElementById("field")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    expect(events).toEqual([]);
    uninstall();
    uninstall = installInputCapture({
      emit: (...args) => events.push(args),
      isTrusted: () => true,
    });
    document
      .getElementById("field")!
      .dispatchEvent(new Event("change", { bubbles: true }));
    expect(events).toEqual([]);
  });
});

function inputFixture(
  markup = '<input id="first"><textarea id="second"></textarea>',
) {
  vi.useFakeTimers();
  document.body.innerHTML = markup;
  const emit = vi.fn();
  const capture = installInputCapture({ emit, isTrusted: () => true });
  uninstall = capture;
  const edit = (id: string, value: string, type = "input") => {
    const field = document.getElementById(id) as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event(type, { bubbles: true }));
    return field;
  };
  return { emit, edit, capture };
}

it("debounces each text field for 300 ms and collapses input/change duplicates", () => {
  const { emit, edit } = inputFixture();
  edit("first", "a");
  vi.advanceTimersByTime(200);
  edit("first", "approved");
  edit("first", "approved");
  expect(emit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(299);
  expect(emit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual([
    "approved",
  ]);
  edit("first", "approved", "change");
  vi.advanceTimersByTime(300);
  expect(emit).toHaveBeenCalledOnce();
});

it("keeps discrete controls immediate and flushes prior text before them", () => {
  const { emit, edit } = inputFixture(
    '<input id="text"><input id="check" type="checkbox"><input id="range" type="range"><select id="select"><option value="a">A</option></select>',
  );
  edit("text", "final");
  expect(emit).not.toHaveBeenCalled();
  edit("check", "yes");
  edit("check", "yes", "change");
  edit("range", "60");
  edit("select", "a", "change");
  expect(
    emit.mock.calls.map(([, value]) => value.target.attributes.id),
  ).toEqual(["text", "check", "range", "select"]);
  expect(vi.getTimerCount()).toBe(0);
});

it("waits for composition completion and emits the final value once", () => {
  const { emit, edit } = inputFixture();
  const field = document.getElementById("first")!;
  edit("first", "prefix");
  field.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true }),
  );
  edit("first", "partial");
  vi.advanceTimersByTime(1000);
  expect(emit).not.toHaveBeenCalled();
  (field as HTMLInputElement).value = "finished";
  field.dispatchEvent(
    new CompositionEvent("compositionend", { bubbles: true }),
  );
  edit("first", "finished");
  vi.advanceTimersByTime(300);
  expect(emit).toHaveBeenCalledOnce();
  expect(emit).toHaveBeenCalledWith(
    "input",
    expect.objectContaining({
      target: expect.objectContaining({ value: "finished" }),
    }),
  );
});

it.each(["reset", "ignore", "password"])(
  "flushes original snapshots before submit and rechecks %s",
  (change) => {
    const { emit, edit } = inputFixture(
      '<form><input id="first" data-copy="original"></form>',
    );
    const input = edit("first", "original");
    expect(emit).not.toHaveBeenCalled();
    if (change === "reset") input.value = "programmatically reset";
    else if (change === "ignore")
      input.setAttribute("data-copilotkit-ignore", "");
    else input.type = "password";
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual(
      change === "reset" ? ["original"] : [],
    );
    if (change !== "reset")
      expect(JSON.stringify(emit.mock.calls)).not.toContain("original");
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("uninstall cancels pending edits and removes flush/composition listeners", () => {
  const { emit, edit } = inputFixture();
  edit("first", "pending");
  expect(emit).not.toHaveBeenCalled();
  uninstall?.();
  expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new Event("click"));
  window.dispatchEvent(new Event("pagehide"));
  document
    .getElementById("first")!
    .dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  vi.advanceTimersByTime(1000);
  expect(emit).not.toHaveBeenCalled();
});

it.each(["change", "focusout", "other-field"])(
  "commits text immediately on %s without a duplicate record",
  (action) => {
    const { emit, edit } = inputFixture();
    const input = edit("first", "committed");
    expect(emit).not.toHaveBeenCalled();
    if (action === "other-field") edit("second", "next");
    else input.dispatchEvent(new Event(action, { bubbles: true }));
    expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual([
      "committed",
    ]);
    vi.advanceTimersByTime(300);
    expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual(
      action === "other-field" ? ["committed", "next"] : ["committed"],
    );
  },
);

it("does not leak a pending snapshot when a host resets and then marks the field as password", () => {
  const { emit, edit } = inputFixture(
    '<input id="first" data-copy="original">',
  );
  const input = edit("first", "original");
  input.value = "reset-value";
  input.type = "password";
  window.dispatchEvent(new Event("pagehide"));
  expect(JSON.stringify(emit.mock.calls)).not.toContain("original");
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["text", "password", "checkbox", "select"])(
  "records a later trusted %s input after the host resets the same value",
  (type) => {
    const markup =
      type === "select"
        ? '<select id="first"><option value="">Empty</option><option value="same">Same</option></select>'
        : `<input id="first" type="${type}">`;
    const { emit, edit } = inputFixture(markup);
    const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(
      "#first",
    )!;
    for (let occurrence = 0; occurrence < 2; occurrence++) {
      field.value = "";
      if (field instanceof HTMLInputElement && type === "checkbox")
        field.checked = false;
      if (field instanceof HTMLInputElement && type === "checkbox")
        field.checked = true;
      edit("first", "same");
      vi.advanceTimersByTime(300);
      edit("first", "same", "change");
    }
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual(
      type === "password" ? ["[redacted]", "[redacted]"] : ["same", "same"],
    );
  },
);

it.each(["checkbox", "select"])(
  "does not deduplicate independent %s change events",
  (type) => {
    const { emit, edit } = inputFixture(
      type === "select"
        ? '<select id="first"><option value="">Empty</option><option value="same">Same</option></select>'
        : '<input id="first" type="checkbox">',
    );
    const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(
      "#first",
    )!;
    for (let occurrence = 0; occurrence < 2; occurrence++) {
      field.value = "";
      if (field instanceof HTMLInputElement) field.checked = false;
      if (field instanceof HTMLInputElement) field.checked = true;
      edit("first", "same", "change");
    }
    expect(emit).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("settles redacted input 300 ms after the latest trusted edit", () => {
  const { emit, edit } = inputFixture('<input id="first" type="password">');
  edit("first", "first-secret");
  vi.advanceTimersByTime(200);
  edit("first", "second-secret");
  vi.advanceTimersByTime(299);
  expect(emit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(emit).toHaveBeenCalledOnce();
  expect(emit.mock.calls[0]?.[1].target.value).toBe("[redacted]");
  expect(JSON.stringify(emit.mock.calls)).not.toContain("secret");
});

it.each(["flush", "click", "submit", "focusout", "pagehide"])(
  "preserves the latest composing input at the %s boundary",
  (boundary) => {
    const { emit, capture } = inputFixture();
    const field = document.querySelector<HTMLInputElement>("#first")!;
    field.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    for (const value of ["partial", "latest user text"]) {
      field.value = value;
      field.dispatchEvent(
        new InputEvent("input", { bubbles: true, isComposing: true }),
      );
    }
    vi.advanceTimersByTime(1000);
    expect(emit).not.toHaveBeenCalled();
    field.value = "host reset";
    if (boundary === "flush") capture.flush();
    else field.dispatchEvent(new Event(boundary, { bubbles: true }));
    expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual([
      "latest user text",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("does not let a late composing input after compositionend poison the field", () => {
  const { emit, edit } = inputFixture();
  const field = document.querySelector<HTMLInputElement>("#first")!;
  field.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true }),
  );
  field.value = "finished";
  field.dispatchEvent(
    new CompositionEvent("compositionend", { bubbles: true }),
  );
  field.dispatchEvent(
    new InputEvent("input", { bubbles: true, isComposing: true }),
  );
  vi.advanceTimersByTime(300);
  expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual([
    "finished",
  ]);
  edit("first", "next edit");
  vi.advanceTimersByTime(300);
  expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual([
    "finished",
    "next edit",
  ]);
});

it("flushes trusted Enter before a no-form send handler resets the input", () => {
  const { emit, edit } = inputFixture();
  const order: string[] = [];
  emit.mockImplementation(() => order.push("input"));
  const field = edit("first", "send this");
  field.addEventListener("keydown", () => {
    order.push("send");
    field.value = "";
  });
  field.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  expect(order).toEqual(["input", "send"]);
  expect(emit.mock.calls[0]?.[1].target.value).toBe("send this");
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["isComposing", "keyCode", "compositionstart"])(
  "keeps IME Enter from flushing partial text identified by %s",
  (signal) => {
    const { emit } = inputFixture();
    const field = document.querySelector<HTMLInputElement>("#first")!;
    if (signal === "compositionstart")
      field.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
    field.value = "partial";
    field.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true }),
    );
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        isComposing: signal === "isComposing",
        keyCode: signal === "keyCode" ? 229 : 13,
      }),
    );
    expect(emit).not.toHaveBeenCalled();
    field.value = "finished";
    field.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    vi.advanceTimersByTime(300);
    expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual([
      "finished",
    ]);
  },
);

it("ignores IME keydown 229 even after compositionend", () => {
  const { emit } = inputFixture();
  const field = document.querySelector<HTMLInputElement>("#first")!;
  field.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true }),
  );
  field.value = "finished";
  field.dispatchEvent(
    new CompositionEvent("compositionend", { bubbles: true }),
  );
  field.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }),
  );
  expect(emit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(299);
  expect(emit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual([
    "finished",
  ]);
});

it.each(["untrusted Enter", "ordinary key"])(
  "does not flush on %s",
  (action) => {
    vi.useFakeTimers();
    document.body.innerHTML = '<input id="first">';
    const emit = vi.fn();
    uninstall = installInputCapture({
      emit,
      isTrusted: (event) =>
        event.type !== "keydown" || action === "ordinary key",
    });
    const field = document.querySelector<HTMLInputElement>("#first")!;
    field.value = "pending";
    field.dispatchEvent(new InputEvent("input", { bubbles: true }));
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: action === "ordinary key" ? "a" : "Enter",
        bubbles: true,
      }),
    );
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(emit.mock.calls.map(([, value]) => value.target.value)).toEqual([
      "pending",
    ]);
  },
);

it("rechecks redaction when explicitly flushing a composing snapshot", () => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<input id="first" data-copy="new-secret"><input id="password" type="password">';
  const redact = createRedactor();
  const emit = vi.fn();
  const capture = installInputCapture({ emit, redact, isTrusted: () => true });
  uninstall = capture;
  const field = document.querySelector<HTMLInputElement>("#first")!;
  field.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true }),
  );
  field.value = "safe text";
  field.dispatchEvent(
    new InputEvent("input", { bubbles: true, isComposing: true }),
  );
  const password = document.querySelector<HTMLInputElement>("#password")!;
  password.value = "new-secret";
  redact.isPassword(password);
  capture.flush();
  expect(emit).toHaveBeenCalledOnce();
  expect(emit.mock.calls[0]?.[1].target.attributes["data-copy"]).toBe(
    "[redacted]",
  );
  expect(JSON.stringify(emit.mock.calls)).not.toContain("new-secret");
});
