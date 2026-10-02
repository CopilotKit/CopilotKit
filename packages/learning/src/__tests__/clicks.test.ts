import { afterEach, describe, expect, it } from "vitest";
import { installClickCapture } from "../clicks";
import type { EnrichFn } from "../types";

interface Captured {
  name: string;
  value: Record<string, unknown>;
}

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  document.body.innerHTML = "";
});

function setup(options: { trustAll?: boolean; enrich?: EnrichFn } = {}) {
  const events: Captured[] = [];
  uninstall = installClickCapture({
    emit: (name, value) => events.push({ name, value }),
    getRoute: () => "/deals/:id",
    enrich: options.enrich,
    isTrusted: options.trustAll === false ? undefined : () => true,
  });
  return events;
}

function byId(id: string) {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el;
}

// jsdom has no PointerEvent; a MouseEvent carries the fields the capture reads.
function pointerDown(el: Element, x = 10, y = 10) {
  el.dispatchEvent(
    new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }),
  );
}

function click(
  el: Element,
  init: MouseEventInit = { detail: 1, clientX: 10, clientY: 10 },
) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
}

describe("installClickCapture", () => {
  it("describes the interactive ancestor of an icon, with its text and attributes", () => {
    document.body.innerHTML = `<button id="b" data-copilotkit-action="deal.approve">
      <svg><path id="icon"></path></svg> Approve $12,000
    </button>`;
    const events = setup();

    click(byId("icon"));

    expect(events).toMatchObject([
      {
        name: "click",
        value: {
          target: {
            tag: "button",
            role: null,
            action: "deal.approve",
            text: expect.stringContaining("Approve $12,000"),
            attributes: { id: "b", "data-copilotkit-action": "deal.approve" },
            input: "pointer",
          },
          route: "/deals/:id",
        },
      },
    ]);
  });

  it("captures clicks deeper than 50 ancestors and still honors an explicit opt-out", () => {
    document.body.innerHTML = `${"<div>".repeat(75)}<button id="deep">Deep action</button>${"</div>".repeat(75)}`;
    const events = setup();
    click(byId("deep"));
    expect(events[0]?.value.target).toMatchObject({
      tag: "button",
      text: "Deep action",
    });
    document.body.setAttribute("data-copilotkit-ignore", "");
    click(byId("deep"));
    expect(events).toHaveLength(1);
    document.body.removeAttribute("data-copilotkit-ignore");
  });

  it("marks keyboard activation and keeps the role", () => {
    document.body.innerHTML = `<div id="tab" role="tab">Overview</div>`;
    const events = setup();

    click(byId("tab"), { detail: 0 });

    expect(events[0]?.value.target).toMatchObject({
      tag: "div",
      role: "tab",
      action: null,
      input: "keyboard",
    });
  });

  it("drops clicks inside an ignored subtree", () => {
    document.body.innerHTML = `<section data-copilotkit-ignore><button id="b">Secret</button></section>`;
    const events = setup();

    click(byId("b"));

    expect(events).toMatchObject([]);
  });

  it("drops clicks inside a shadow root whose host is in an ignored subtree", () => {
    document.body.innerHTML = `<section data-copilotkit-ignore><div id="host"></div></section>`;
    const root = byId("host").attachShadow({ mode: "open" });
    root.innerHTML = `<button id="inner">Secret</button>`;
    const inner = root.getElementById("inner");
    if (inner === null) throw new Error("missing #inner");
    const events = setup();

    // Real clicks are composed, so they reach the window listener from inside a shadow root.
    click(inner, { detail: 1, clientX: 10, clientY: 10, composed: true });

    expect(events).toEqual([]);
  });

  it("caps the captured text of a large container", () => {
    document.body.innerHTML = `<div id="panel" role="region">${"x".repeat(5000)}</div>`;
    const events = setup();

    click(byId("panel"));

    expect(events[0]?.value).toMatchObject({
      target: { text: "x".repeat(1000) },
    });
  });

  it("redacts a password value attribute", () => {
    document.body.innerHTML = `<input id="pw" type="password" value="secret">`;
    const events = setup();

    click(byId("pw"));

    expect(events[0]?.value).toMatchObject({
      target: { value: "[redacted]", attributes: { value: "[redacted]" } },
    });
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("drops programmatic clicks by default", () => {
    document.body.innerHTML = `<button id="b">Upload</button>`;
    const events = setup({ trustAll: false });

    byId("b").click();

    expect(events).toMatchObject([]);
  });

  it("uses the pointerdown target when a re-render moves the click to body", () => {
    document.body.innerHTML = `<button id="b" data-copilotkit-action="row.open">Open</button>`;
    const events = setup();

    pointerDown(byId("b"));
    byId("b").remove();
    click(document.body);

    expect(events[0]?.value.target).toMatchObject({
      tag: "button",
      role: null,
      action: "row.open",
      input: "pointer",
    });
  });

  it("merges enrich fields from the clicked element", () => {
    document.body.innerHTML = `<div data-message-id="m1"><button id="b">Yes</button></div>`;
    const events = setup({
      enrich: (target) => ({
        messageId: target
          .closest("[data-message-id]")
          ?.getAttribute("data-message-id"),
      }),
    });

    click(byId("b"));

    expect(events[0]?.value).toMatchObject({
      messageId: "m1",
      route: "/deals/:id",
    });
  });

  it("stops capturing after uninstall", () => {
    document.body.innerHTML = `<button id="b">Go</button>`;
    const events = setup();
    uninstall?.();

    click(byId("b"));

    expect(events).toMatchObject([]);
  });
});
