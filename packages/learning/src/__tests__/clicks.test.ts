import { afterEach, describe, expect, it } from "vitest";
import { installClickCapture } from "../clicks";
import { createRedactor } from "../redact";
import type { Redactor } from "../redact";
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

function setup(
  options: { trustAll?: boolean; enrich?: EnrichFn; redact?: Redactor } = {},
) {
  const events: Captured[] = [];
  uninstall = installClickCapture({
    emit: (name, value) => events.push({ name, value }),
    getRoute: () => "/deals/:id",
    enrich: options.enrich,
    isTrusted: options.trustAll === false ? undefined : () => true,
    redact: options.redact,
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

describe("click target label", () => {
  /** Clicks `#id` (or the element itself) and returns the captured target. */
  function clickTarget(target: string | Element, redact?: Redactor) {
    const events = setup({ redact });
    click(typeof target === "string" ? byId(target) : target);
    expect(events).toHaveLength(1);
    return events[0]!.value.target as { label?: string; text: string };
  }

  describe("names a control", () => {
    it("uses aria-label on an icon-only button", () => {
      document.body.innerHTML = `<button id="b" aria-label="Switch to dark mode"><svg><path></path></svg></button>`;
      expect(clickTarget("b").label).toBe("Switch to dark mode");
    });

    it("uses title", () => {
      document.body.innerHTML = `<button id="b" title="Copy Code"><svg></svg></button>`;
      expect(clickTarget("b").label).toBe("Copy Code");
    });

    it("uses the text of a button", () => {
      document.body.innerHTML = `<button id="b">Approve</button>`;
      expect(clickTarget("b").label).toBe("Approve");
    });

    it("joins text from nested elements and collapses whitespace", () => {
      document.body.innerHTML = `<button id="b">
        <span>Thought</span>
        <span>for <b>2</b> seconds</span>
      </button>`;
      expect(clickTarget("b").label).toBe("Thought for 2 seconds");
    });

    it("resolves aria-labelledby in order", () => {
      document.body.innerHTML = `<h2 id="first">Invoice</h2><span id="second" hidden>Delete <i aria-hidden="true">icon</i></span><button id="b" aria-labelledby="second first" aria-label="Ignored">x</button>`;
      expect(clickTarget("b").label).toBe("Delete Invoice");
    });

    it("uses the text of a tab", () => {
      document.body.innerHTML = `<div id="tab" role="tab">Overview</div>`;
      expect(clickTarget("tab").label).toBe("Overview");
    });

    it("uses the text of an element with a control role", () => {
      document.body.innerHTML = `<div id="b" role="button">Retry</div>`;
      expect(clickTarget("b").label).toBe("Retry");
    });

    it("uses the text of a link", () => {
      document.body.innerHTML = `<a id="a" href="#settings">Account settings</a>`;
      expect(clickTarget("a").label).toBe("Account settings");
    });

    it("uses the caption of a submit input", () => {
      document.body.innerHTML = `<input id="s" type="submit" value="Save changes">`;
      expect(clickTarget("s").label).toBe("Save changes");
    });

    it("uses alt of an image input and of an image", () => {
      document.body.innerHTML = `<input id="i" type="image" alt="Search" src="search.png"><img id="img" alt="Company logo" src="logo.png">`;
      expect(clickTarget("i").label).toBe("Search");
      uninstall?.();
      expect(clickTarget("img").label).toBe("Company logo");
    });

    it("names the button when its icon is clicked", () => {
      document.body.innerHTML = `<button aria-label="Close dialog"><svg><path id="icon"></path></svg></button><button><svg><path id="icon2"></path></svg> Send</button>`;
      expect(clickTarget("icon").label).toBe("Close dialog");
      uninstall?.();
      expect(clickTarget("icon2").label).toBe("Send");
    });
  });

  describe("does not use user content", () => {
    it("ignores title on a text input with a typed value, but keeps aria-label", () => {
      document.body.innerHTML = `<input id="q" type="text" title="jane.private query"><input id="named" type="search" aria-label="Search customers" title="jane.private query">`;
      (byId("q") as HTMLInputElement).value = "jane.private query";
      (byId("named") as HTMLInputElement).value = "jane.private query";
      expect(clickTarget("q").label).toBeUndefined();
      uninstall?.();
      expect(clickTarget("named").label).toBe("Search customers");
    });

    it("ignores title on a text area and a select", () => {
      document.body.innerHTML = `<textarea id="t" title="Draft text">Draft text</textarea><select id="s" title="Chosen plan"><option>Chosen plan</option></select>`;
      expect(clickTarget("t").label).toBeUndefined();
      uninstall?.();
      expect(clickTarget("s").label).toBeUndefined();
    });

    it("gives a contenteditable no label", () => {
      document.body.innerHTML = `<div id="e" contenteditable="true" title="My private note">My private note</div>`;
      expect(clickTarget("e").label).toBeUndefined();
    });

    it("gives containers no label from their text", () => {
      document.body.innerHTML = `<div id="item" role="listitem">Jane Doe, diagnosis pending</div><ul><li id="li">Jane Doe, diagnosis pending</li></ul><div id="main" role="main">Jane Doe, diagnosis pending</div><div id="card" data-copilotkit-action="card.open">Jane Doe, diagnosis pending</div><label id="label">Jane Doe, diagnosis pending</label>`;
      for (const id of ["item", "li", "main", "card", "label"]) {
        const target = clickTarget(id);
        expect(target.label).toBeUndefined();
        expect(target.text).toContain("Jane Doe");
        uninstall?.();
      }
    });

    it("gives a control that contains an editable element no text label", () => {
      document.body.innerHTML = `<div id="b" role="button">Rename to <input value="Q3 layoffs"> Q3 layoffs</div><div id="named" role="button" aria-label="Rename file">Q3 layoffs <span contenteditable="true">Q3 layoffs</span></div>`;
      expect(clickTarget("b").label).toBeUndefined();
      uninstall?.();
      expect(clickTarget("named").label).toBe("Rename file");
    });

    it("gives a combobox suggestion that repeats the query no text label", () => {
      document.body.innerHTML = `<input role="combobox" aria-autocomplete="list" aria-controls="suggestions"><ul id="suggestions" role="listbox"><li id="o" role="option">divorce lawyer near me</li><li id="named" role="option" aria-label="Suggestion 2">divorce lawyer cost</li></ul>`;
      const target = clickTarget("o");
      expect(target.label).toBeUndefined();
      uninstall?.();
      expect(clickTarget("named").label).toBe("Suggestion 2");
    });

    it("gives options of a datalist or a combobox-owned listbox no text label", () => {
      document.body.innerHTML = `<div role="combobox" aria-owns="owned"><input></div><div id="owned" role="listbox"><div id="o1" role="option">private search one</div></div><input aria-autocomplete="list" aria-controls="controlled"><div id="controlled" role="listbox"><div id="o2" role="option">private search two</div></div><div role="combobox"><div role="listbox"><div id="o3" role="option">private search three</div></div></div><datalist id="dl"><option id="o4" role="option">private search four</option></datalist>`;
      for (const id of ["o1", "o2", "o3", "o4"]) {
        expect(clickTarget(id).label).toBeUndefined();
        uninstall?.();
      }
    });

    it("still names an option of a plain listbox", () => {
      document.body.innerHTML = `<div id="list" role="listbox"><div id="o" role="option">Monthly</div></div>`;
      expect(clickTarget("o").label).toBe("Monthly");
    });

    it("excludes script, style, template, hidden, and aria-hidden content", () => {
      document.body.innerHTML = `<button id="b">Save<script>leakone</script><style>.leaktwo{}</style><template>leakthree</template><span hidden>leakfour</span><span aria-hidden="true">leak<b>five</b></span></button>`;
      const { label } = clickTarget("b");
      expect(label).toBe("Save");
      expect(label).not.toMatch(/leak|five/);
    });
  });

  describe("cleans the name", () => {
    it("replaces a URL in link text, including its token", () => {
      document.body.innerHTML = `<a id="a" href="#reset">Open https://app.example.com/reset?token=Zx81Qp and www.example.org/a</a>`;
      const target = clickTarget("a");
      expect(target.label).toBe("Open [url] and [url]");
      expect(target.label).not.toMatch(/Zx81Qp|example/);
      expect(target.text).toContain("Zx81Qp");
    });

    it("replaces an email", () => {
      document.body.innerHTML = `<button id="b">Email jane.doe@example.com now</button>`;
      const target = clickTarget("b");
      expect(target.label).toBe("Email [email] now");
      expect(target.label).not.toContain("jane.doe");
      expect(target.text).toContain("jane.doe@example.com");
    });

    it("replaces JWT-shaped and long token-like strings", () => {
      const jwt = "eyJfixture.eyJpayload.placeholder";
      const key = "tok9f3a8b2c7d1e6f4a0b5c9d2e8f7a1b3c";
      document.body.innerHTML = `<button id="b" aria-label="Copy ${jwt} or ${key} for averyveryverylongwordwithoutdigits"></button>`;
      const { label } = clickTarget("b");
      expect(label).toBe(
        "Copy [redacted] or [redacted] for averyveryverylongwordwithoutdigits",
      );
      expect(label).not.toMatch(/eyJ|tok9f3a/);
    });

    it("strips bidi control and zero-width characters", () => {
      document.body.innerHTML = `<button id="b">\u202EAp\u200Bpro\u2066ve\u2069\uFEFF\u200F</button>`;
      expect(clickTarget("b").label).toBe("Approve");
    });

    it("caps an aria-label at 80 characters with an ellipsis", () => {
      document.body.innerHTML = `<button id="b" aria-label="${"Long name ".repeat(20)}"></button>`;
      const { label } = clickTarget("b");
      expect(label).toHaveLength(80);
      expect(label).toMatch(/^Long name Long name .*…$/);
    });

    it("scrubs a remembered password and credential pairs shown in a button", () => {
      document.body.innerHTML = `<input id="pw" type="password"><button id="b">Your password hunter2secret, token=abc123</button>`;
      const redact = createRedactor();
      const field = byId("pw") as HTMLInputElement;
      field.value = "hunter2secret";
      redact.isPassword(field);
      const { label } = clickTarget("b", redact);
      expect(label).toBe("Your password [redacted], token=[redacted]");
      expect(label).not.toMatch(/hunter2secret|abc123/);
    });

    it("omits the label when nothing is left after cleaning", () => {
      document.body.innerHTML = `<button id="b" aria-label="\u200B \u202E">  <span aria-hidden="true">x</span></button>`;
      expect(clickTarget("b")).not.toHaveProperty("label");
    });
  });

  describe("review hardening", () => {
    it("gives no text label to a link or role=button card with structured content", () => {
      document.body.innerHTML = `<a id="a" href="#inbox-1"><div><h3>Jane Doe</h3><p>Re: biopsy results</p></div></a><div id="b" role="button" class="card"><h3>Jane Doe</h3><p>Pending diagnosis</p></div><button id="list"><ul><li>Jane Doe</li></ul></button>`;
      for (const id of ["a", "b", "list"]) {
        const target = clickTarget(id);
        expect(target.label).toBeUndefined();
        expect(target.text).toContain("Jane Doe");
        uninstall?.();
      }
    });

    it("drops control text longer than 80 characters instead of cutting it", () => {
      const text =
        "Jane Doe asked about the results of her appointment last Tuesday at the clinic";
      document.body.innerHTML = `<a id="a" href="#m">${text} again</a>`;
      expect(clickTarget("a").label).toBeUndefined();
    });

    it("keeps naming plain navigation links and buttons", () => {
      document.body.innerHTML = `<nav><a id="a" href="#docs"><span>Docs</span></a></nav><button id="b"><span>Save</span> <span>Draft</span></button><a id="c" href="#c">Save<br>Draft</a>`;
      expect(clickTarget("a").label).toBe("Docs");
      uninstall?.();
      expect(clickTarget("b").label).toBe("Save Draft");
      uninstall?.();
      expect(clickTarget("c").label).toBe("Save Draft");
    });

    it("gives an anchor without href no text label", () => {
      document.body.innerHTML = `<a id="a">Jane Doe private note</a>`;
      expect(clickTarget("a").label).toBeUndefined();
    });

    it("does not resolve aria-labelledby into editable content", () => {
      document.body.innerHTML = `<div contenteditable="true"><h2 id="h1">My secret draft heading</h2></div><div role="textbox"><span id="h2">typed secret text</span></div><button id="b1" aria-labelledby="h1"><svg></svg></button><button id="b2" aria-labelledby="h2"><svg></svg></button>`;
      for (const id of ["b1", "b2"]) {
        expect(clickTarget(id).label).toBeUndefined();
        uninstall?.();
      }
    });

    it("strips default-ignorable characters, so they cannot hide an email", () => {
      document.body.innerHTML = `<button id="b1">Email jane.doe@exam\u00ADple.com</button><button id="b2">Email jane\u2060@example.com</button><button id="b3">Approve\u{E0049}\u{E0047}\u{E004E}</button><button id="b4">Save\uFE0F</button>`;
      expect(clickTarget("b1").label).toBe("Email [email]");
      uninstall?.();
      expect(clickTarget("b2").label).toBe("Email [email]");
      uninstall?.();
      expect(clickTarget("b3").label).toBe("Approve");
      uninstall?.();
      expect(clickTarget("b4").label).toBe("Save");
    });

    it("replaces emails with non-ASCII letters", () => {
      document.body.innerHTML = `<button id="b1">Mail jürgen.schmidt@example.de</button><button id="b2">Mail jane@müller.de</button>`;
      expect(clickTarget("b1").label).toBe("Mail [email]");
      uninstall?.();
      expect(clickTarget("b2").label).toBe("Mail [email]");
    });

    it("names a decorative icon from its own name or its control", () => {
      document.body.innerHTML = `<button><svg id="svg" role="img"><path></path></svg> Send</button><button><span id="span" role="presentation" class="icon"></span> Archive</button><button><svg id="named" role="img" aria-label="Close"></svg></button><div><svg id="lone" role="img"></svg></div>`;
      const target = clickTarget("svg") as { label?: string; tag?: string };
      expect(target).toMatchObject({ label: "Send", tag: "svg" });
      uninstall?.();
      expect(clickTarget("span").label).toBe("Archive");
      uninstall?.();
      expect(clickTarget("named").label).toBe("Close");
      uninstall?.();
      expect(clickTarget("lone").label).toBeUndefined();
    });

    it("uses alt and aria-label of images inside a control", () => {
      document.body.innerHTML = `<a id="a" href="#home"><img alt="Home" src="home.png"></a><button id="b"><svg role="img" aria-label="Settings"></svg></button>`;
      expect(clickTarget("a").label).toBe("Home");
      uninstall?.();
      expect(clickTarget("b").label).toBe("Settings");
    });

    it("treats tree items and options inside a combobox popup as suggestions", () => {
      document.body.innerHTML = `<input role="combobox" aria-controls="tree"><ul id="tree" role="tree"><li id="t" role="treeitem">divorce lawyer near me</li></ul><input role="combobox" aria-controls="pop"><div id="pop"><div role="listbox"><div id="o" role="option">divorce lawyer cost</div></div></div>`;
      expect(clickTarget("t").label).toBeUndefined();
      uninstall?.();
      expect(clickTarget("o").label).toBeUndefined();
    });

    it("uses title only on controls", () => {
      document.body.innerHTML = `<table><tr><td><span id="s" title="jane.doe@x.com Jane Doe">Jane…</span></td></tr></table><div id="item" role="listitem" title="Jane Doe">Jane</div><span id="named" aria-label="Status badge" title="Jane Doe">J</span>`;
      expect(clickTarget("s").label).toBeUndefined();
      uninstall?.();
      expect(clickTarget("item").label).toBeUndefined();
      uninstall?.();
      expect(clickTarget("named").label).toBe("Status badge");
    });

    it("scrubs a remembered password whose whitespace differs on screen", () => {
      document.body.innerHTML = `<input id="pw" type="password"><button id="b">Show: correct
         horse</button>`;
      const redact = createRedactor();
      const field = byId("pw") as HTMLInputElement;
      field.value = "correct horse";
      redact.isPassword(field);
      const { label } = clickTarget("b", redact);
      expect(label).toBe("Show: [redacted]");
      expect(label).not.toContain("horse");
    });

    it("bounds the text walk on large or deep subtrees", () => {
      document.body.innerHTML = `<a id="wide" href="#w">Inbox${"<span></span>".repeat(2000)}</a><a id="deep" href="#d">${"<span>".repeat(1500)}Deep${"</span>".repeat(1500)}</a>`;
      expect(clickTarget("wide").label).toBeUndefined();
      uninstall?.();
      expect(clickTarget("deep").label).toBeUndefined();
    });
  });

  describe("second review hardening", () => {
    it("gives no text label to div fields that hold text through inline elements", () => {
      document.body.innerHTML = `<a id="span" href="#p-9"><div><span>Jane Doe</span></div><div><span>HIV positive</span></div></a><a id="bold" href="#p-10"><div><b>Jane Doe</b></div><div><span><b>HIV positive</b></span></div></a>`;
      for (const id of ["span", "bold"]) {
        const target = clickTarget(id);
        expect(target.label).toBeUndefined();
        expect(target.text).toContain("HIV positive");
        uninstall?.();
      }
    });

    it("gives no text label to cards built from div and span fields", () => {
      document.body.innerHTML = `<a id="a" href="#patients-9"><div><span>Jane Doe</span><span>DOB 1980-04-02</span><span>Oncology</span></div></a><div id="b" role="button"><div>Jane Doe</div><div>HIV positive</div></div>`;
      for (const id of ["a", "b"]) {
        const target = clickTarget(id);
        expect(target.label).toBeUndefined();
        expect(target.text).toContain("Jane Doe");
        uninstall?.();
      }
    });

    it("keeps naming controls with one or two text parts", () => {
      document.body.innerHTML = `<button id="nested"><div><span>Save</span></div></button><button id="icon"><svg aria-hidden="true"><path d="M0"></path></svg><span>Save</span></button><button id="two"><span>Thought for</span> <span>2 seconds</span></button>`;
      expect(clickTarget("nested").label).toBe("Save");
      uninstall?.();
      expect(clickTarget("icon").label).toBe("Save");
      uninstall?.();
      expect(clickTarget("two").label).toBe("Thought for 2 seconds");
    });

    it("scrubs a remembered password that differs in whitespace or invisible characters", () => {
      for (const password of ["tr0ub  4dor", "tr0ub\u00AD4dor"]) {
        document.body.innerHTML = `<input id="pw" type="password"><button id="b">Show ${password}</button>`;
        const redact = createRedactor();
        const field = byId("pw") as HTMLInputElement;
        field.value = password;
        redact.isPassword(field);
        const { label } = clickTarget("b", redact);
        expect(label).toBe("Show [redacted]");
        uninstall?.();
      }
    });

    it("keeps dotted names and redacts dotted tokens", () => {
      document.body.innerHTML = `<button id="name">Open settings.notifications.preferences</button><button id="digits">Use a1b2c3d4e5.f6g7h8i9j0.k1l2m3n4o5</button><button id="long">Use abcdefghijklmnopq.rstuvwxyzabcdefgh.ijklmnopqrstuvwxy</button>`;
      expect(clickTarget("name").label).toBe(
        "Open settings.notifications.preferences",
      );
      uninstall?.();
      expect(clickTarget("digits").label).toBe("Use [redacted]");
      uninstall?.();
      expect(clickTarget("long").label).toBe("Use [redacted]");
    });

    it("does not split words at inline formatting", () => {
      document.body.innerHTML = `<button id="b">S<u>ave</u></button><a id="a" href="#docs">Java<mark>Script</mark> guide</a>`;
      expect(clickTarget("b").label).toBe("Save");
      uninstall?.();
      expect(clickTarget("a").label).toBe("JavaScript guide");
    });

    it("allows one paragraph, and headings inside summary", () => {
      document.body.innerHTML = `<a id="a" href="#start"><div><p class="framer-text">Get started</p></div></a><details><summary id="s"><h3>Shipping and returns</h3></summary></details><a id="two" href="#two"><p>Jane Doe</p><p>Pending</p></a>`;
      expect(clickTarget("a").label).toBe("Get started");
      uninstall?.();
      expect(clickTarget("s").label).toBe("Shipping and returns");
      uninstall?.();
      expect(clickTarget("two").label).toBeUndefined();
    });

    it("names an svg by its aria-label or title without walking inside it", () => {
      document.body.innerHTML = `<button id="label"><svg aria-label="Delete"><path></path></svg></button><button id="title"><svg><title>Download</title><path></path></svg></button><a id="logo" href="#home"><svg>${"<path></path>".repeat(1200)}</svg><span>Home</span></a>`;
      expect(clickTarget("label").label).toBe("Delete");
      uninstall?.();
      expect(clickTarget("title").label).toBe("Download");
      uninstall?.();
      expect(clickTarget("logo").label).toBe("Home");
    });

    it("does not name a native checkbox from its label text", () => {
      document.body.innerHTML = `<input type="checkbox" id="t"><label for="t">Buy milk for Jane</label><input type="checkbox" id="named" aria-label="Mark done"><label for="named">Buy milk for Jane</label>`;
      expect(clickTarget("t").label).toBeUndefined();
      uninstall?.();
      expect(clickTarget("named").label).toBe("Mark done");
    });

    it("does not read text slotted into a web component", () => {
      document.body.innerHTML = `<my-button id="host">Save</my-button>`;
      const root = byId("host").attachShadow({ mode: "open" });
      root.innerHTML = `<button id="inner"><slot></slot></button>`;
      const events = setup();
      click(root.getElementById("inner")!, {
        detail: 1,
        clientX: 10,
        clientY: 10,
        composed: true,
      });
      expect(events[0]?.value.target).not.toHaveProperty("label");
    });

    it("cuts long aria-labelledby text instead of dropping it", () => {
      document.body.innerHTML = `<span id="l">${"word ".repeat(70)}</span><button id="b" aria-labelledby="l">Go</button>`;
      const { label } = clickTarget("b");
      expect(label).toMatch(/^word word .*…$/);
      expect(Array.from(label!)).toHaveLength(80);
    });

    it("measures the 80-character limit in code points", () => {
      const emoji = "\u{1F600}".repeat(41);
      document.body.innerHTML = `<button id="b">${emoji}</button>`;
      expect(clickTarget("b").label).toBe(emoji);
    });
  });

  it("drops a named control inside data-copilotkit-ignore", () => {
    document.body.innerHTML = `<div data-copilotkit-ignore><button id="b" aria-label="Delete account">Delete account</button></div>`;
    const events = setup();
    click(byId("b"));
    expect(events).toEqual([]);
  });

  it("labels the pointerdown target when a re-render moves the click to body", () => {
    document.body.innerHTML = `<button id="b">Open row</button>`;
    const events = setup();
    pointerDown(byId("b"));
    byId("b").remove();
    click(document.body);
    expect(events[0]?.value.target).toMatchObject({ label: "Open row" });
  });
});
