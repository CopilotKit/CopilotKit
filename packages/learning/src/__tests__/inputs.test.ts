import { afterEach, describe, expect, it } from "vitest";
import { installInputCapture } from "../inputs";

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  document.body.innerHTML = "";
});

describe("input capture", () => {
  it("captures edited text, checkbox state, and selected values, and redacts passwords", () => {
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
