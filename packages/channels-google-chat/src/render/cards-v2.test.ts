import { describe, it, expect } from "vitest";
import { renderGoogleChatMessage } from "./cards-v2.js";
import { GCHAT_LIMITS } from "./budget.js";
import type { ChannelNode } from "@copilotkit/channels-ui";

const text = (value: string): ChannelNode => ({
  type: "text",
  props: { value },
});
const section = (t: string): ChannelNode => ({
  type: "section",
  props: { children: [text(t)] },
});
const header = (t: string): ChannelNode => ({
  type: "header",
  props: { children: [text(t)] },
});

describe("renderGoogleChatMessage", () => {
  it("renders a lone text node as a plain text message (no card)", () => {
    const out = renderGoogleChatMessage([text("hello")]);
    expect(out.text).toBe("hello");
    expect(out.cardsV2).toBeUndefined();
  });

  it("renders a header+section as a cardsV2 card", () => {
    const out = renderGoogleChatMessage([header("Title"), section("Body")]);
    expect(out.cardsV2).toHaveLength(1);
    const card = (out.cardsV2![0] as any).card;
    expect(card.header.title).toBe("Title");
    expect(JSON.stringify(card.sections)).toContain("Body");
  });

  it("clamps widgets to the per-card budget", () => {
    const many = Array.from({ length: 200 }, (_, i) => section(`s${i}`));
    const out = renderGoogleChatMessage(many);
    const widgets = (out.cardsV2![0] as any).card.sections.flatMap(
      (s: any) => s.widgets,
    );
    expect(widgets.length).toBeLessThanOrEqual(100);
  });

  it("appends a '… N more …' indicator when section widgets overflow the per-card budget", () => {
    const many = Array.from({ length: 130 }, (_, i) => section(`s${i}`));
    const out = renderGoogleChatMessage(many);
    const widgets = (out.cardsV2![0] as any).card.sections.flatMap(
      (s: any) => s.widgets,
    );

    // Still within the per-card budget.
    expect(widgets.length).toBeLessThanOrEqual(100);

    // The final widget is the overflow indicator carrying the hidden count.
    const last = widgets[widgets.length - 1];
    expect(last.textParagraph).toBeDefined();
    expect(last.textParagraph.text).toMatch(/^… \d+ more not shown$/);
    // 130 inputs, 99 kept + 1 indicator = 100, so 31 are hidden.
    expect(last.textParagraph.text).toContain("31 more");
  });

  it("gives two handler-less, value-less buttons distinct onClick.action.function ids", () => {
    const button = (label: string): ChannelNode => ({
      type: "button",
      props: { children: [text(label)] },
    });
    const actionsNode: ChannelNode = {
      type: "actions",
      props: { children: [button("One"), button("Two")] },
    };

    const out = renderGoogleChatMessage([actionsNode]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const buttons = widgets.find((w) => w.buttonList !== undefined).buttonList
      .buttons;

    expect(buttons).toHaveLength(2);
    const fnA = buttons[0].onClick.action.function;
    const fnB = buttons[1].onClick.action.function;
    expect(fnA).not.toBe(fnB);
  });

  it("gives handler-less buttons in two SEPARATE action sets card-wide-distinct ids", () => {
    // Each `renderActionsWidget` call indexes its own buttons from 0, so a
    // per-set index would collide across sets. The card-wide allocator must
    // keep every handler-less button's function id distinct.
    const button = (label: string): ChannelNode => ({
      type: "button",
      props: { children: [text(label)] },
    });
    const actionsA: ChannelNode = {
      type: "actions",
      props: { children: [button("A1"), button("A2")] },
    };
    const actionsB: ChannelNode = {
      type: "actions",
      props: { children: [button("B1"), button("B2")] },
    };

    const out = renderGoogleChatMessage([actionsA, actionsB]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const buttonLists = widgets.filter((w) => w.buttonList !== undefined);
    expect(buttonLists).toHaveLength(2);

    const fnIds = buttonLists.flatMap((w) =>
      w.buttonList.buttons.map((b: any) => b.onClick.action.function),
    );
    expect(fnIds).toHaveLength(4);
    // All four are distinct card-wide.
    expect(new Set(fnIds).size).toBe(4);
  });

  it("renders an actions/button node as a buttonList widget with the ck: id in onClick.action.function", () => {
    // Simulate a button whose onClick has been stamped with a ck: id by the action registry.
    const ckId = "ck:abc123";
    const button: ChannelNode = {
      type: "button",
      props: {
        onClick: { id: ckId },
        value: { answer: 42 },
        children: [text("Click me")],
      },
    };
    const actionsNode: ChannelNode = {
      type: "actions",
      props: { children: [button] },
    };

    const out = renderGoogleChatMessage([actionsNode]);
    // The result should be a cardsV2 card (not plain text) because `actions` is not a text node.
    expect(out.cardsV2).toBeDefined();
    expect(out.cardsV2).toHaveLength(1);

    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);

    // There should be exactly one buttonList widget.
    const buttonListWidget = widgets.find((w) => w.buttonList !== undefined);
    expect(buttonListWidget).toBeDefined();

    const buttons = buttonListWidget.buttonList.buttons;
    expect(buttons).toHaveLength(1);

    // The ck: id must be carried in onClick.action.function (the round-trip contract
    // for decodeInteraction which reads it from common.invokedFunction).
    expect(buttons[0].onClick.action.function).toBe(ckId);

    // The button value should be serialized as a JSON string in the parameters.
    const params: any[] = buttons[0].onClick.action.parameters;
    const valueParam = params.find((p: any) => p.key === "value");
    expect(valueParam).toBeDefined();
    expect(JSON.parse(valueParam.value)).toEqual({ answer: 42 });

    // The button text should be present.
    expect(buttons[0].text).toBe("Click me");
  });

  it("renders a field as a decoratedText whose `text` (not just topLabel) carries the content", () => {
    const fieldsNode: ChannelNode = {
      type: "fields",
      props: {
        children: [
          { type: "field", props: { children: [text("Status: Online")] } },
        ],
      },
    };

    const out = renderGoogleChatMessage([fieldsNode]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);

    const decorated = widgets.find((w) => w.decoratedText !== undefined);
    expect(decorated).toBeDefined();
    // `decoratedText` REQUIRES `text` — content must live there, not only in topLabel.
    expect(decorated.decoratedText.text).toBe("Status: Online");
  });

  it("skips an image widget when the node has no url (would otherwise fail the cardsV2 API)", () => {
    const imageNode: ChannelNode = {
      type: "image",
      props: { alt: "missing" },
    };
    // Pair it with a section so the card still has at least one widget.
    const out = renderGoogleChatMessage([section("Body"), imageNode]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);

    // No image widget — and certainly none with an empty imageUrl.
    expect(widgets.find((w) => w.image !== undefined)).toBeUndefined();
    expect(JSON.stringify(widgets)).not.toContain('"imageUrl":""');
    // The section text still rendered.
    expect(widgets.some((w) => w.textParagraph !== undefined)).toBe(true);
  });

  it("still renders an image widget when the node has a url", () => {
    const imageNode: ChannelNode = {
      type: "image",
      props: { url: "https://example.com/a.png", alt: "A" },
    };
    const out = renderGoogleChatMessage([imageNode]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const img = widgets.find((w) => w.image !== undefined);
    expect(img.image.imageUrl).toBe("https://example.com/a.png");
    expect(img.image.altText).toBe("A");
  });

  it("converts Markdown in section text to the Chat HTML subset (<b>, <i>, <s>, <a href>)", () => {
    const node: ChannelNode = {
      type: "section",
      props: {
        children: [text("**bold** _it_ ~~no~~ [link](https://x.com) # Title")],
      },
    };
    const out = renderGoogleChatMessage([node]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html = tp.textParagraph.text;

    expect(html).toContain("<b>bold</b>");
    expect(html).toContain("<i>it</i>");
    expect(html).toContain("<s>no</s>");
    expect(html).toContain('<a href="https://x.com">link</a>');
    // No literal Markdown punctuation should leak through.
    expect(html).not.toContain("**");
    expect(html).not.toContain("~~");
  });

  it("preserves literal CODE<n> in card text when no code regions exist", () => {
    // Regression: the code-region placeholder must use a collision-proof
    // \x10 sentinel (mirroring markdown.ts), not a human-typeable token, so
    // card-routed prose containing "CODE0" is not deleted during restore.
    const out = renderGoogleChatMessage([section("refer to CODE0 here")]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    expect(tp.textParagraph.text).toContain("CODE0");
  });

  it("preserves literal CODE<n> in card text alongside a real code region", () => {
    const out = renderGoogleChatMessage([
      section("see `x` and refer to CODE0"),
    ]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html = tp.textParagraph.text;
    // The real inline code is restored verbatim AND the literal CODE0 survives.
    expect(html).toContain("`x`");
    expect(html).toContain("CODE0");
  });

  it("escapes raw HTML in card text so it can't inject markup", () => {
    const node = section("a < b & c > d");
    const out = renderGoogleChatMessage([node]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    expect(tp.textParagraph.text).toBe("a &lt; b &amp; c &gt; d");
  });

  it("omits the `value` parameter for a button with no value", () => {
    const button: ChannelNode = {
      type: "button",
      props: { onClick: { id: "ck:novalue" }, children: [text("Go")] },
    };
    const actionsNode: ChannelNode = {
      type: "actions",
      props: { children: [button] },
    };
    const out = renderGoogleChatMessage([actionsNode]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const buttons = widgets.find((w) => w.buttonList !== undefined).buttonList
      .buttons;

    const params: any[] = buttons[0].onClick.action.parameters;
    expect(params.find((p: any) => p.key === "value")).toBeUndefined();
    // The ck: function id round-trip is unaffected.
    expect(buttons[0].onClick.action.function).toBe("ck:novalue");
  });

  it("drops a javascript: link in card text and keeps only the escaped visible text", () => {
    const out = renderGoogleChatMessage([
      section("[click me](javascript:alert(1))"),
    ]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html = tp.textParagraph.text;

    // No anchor, no dangerous scheme — just the visible text.
    expect(html).not.toContain("<a href");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click me");
  });

  it("keeps a normal https link in card text (regression)", () => {
    const out = renderGoogleChatMessage([
      section("[CK](https://copilotkit.ai)"),
    ]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    expect(tp.textParagraph.text).toContain(
      '<a href="https://copilotkit.ai">CK</a>',
    );
  });

  it("strips sentinel control bytes from card text without corrupting it", () => {
    // A literal \x10 sentinel pasted into content must be removed before the
    // code-placeholder machinery runs, and the surrounding text preserved.
    const out = renderGoogleChatMessage([section("before\x10CODE0\x10after")]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html = tp.textParagraph.text;
    expect(html).not.toContain("\x10");
    expect(html).toContain("beforeCODE0after");
  });

  it("budgets the FINAL card HTML, never cutting mid-tag or mid-entity", () => {
    // Build markdown whose converted HTML is far larger than the limit:
    // many `&` (→ &amp;, 5 chars each) plus bold spans that expand to tags.
    const big = "**x** & ".repeat(2000).trim();
    const out = renderGoogleChatMessage([section(big)]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html = tp.textParagraph.text;

    // Within the Chat limit after expansion.
    expect(html.length).toBeLessThanOrEqual(GCHAT_LIMITS.textParagraph);

    // Not cut in the middle of a tag: no trailing unterminated `<…`.
    const lastLt = html.lastIndexOf("<");
    const lastGt = html.lastIndexOf(">");
    expect(lastLt).toBeLessThanOrEqual(lastGt);

    // Not cut in the middle of an entity: no trailing unterminated `&…`.
    const lastAmp = html.lastIndexOf("&");
    const lastSemi = html.lastIndexOf(";");
    if (lastAmp !== -1) expect(lastAmp).toBeLessThanOrEqual(lastSemi);

    // Every emitted tag is balanced (no dangling open <b>/<i>/<s>).
    const opens = (html.match(/<(b|i|s)>/g) ?? []).length;
    const closes = (html.match(/<\/(b|i|s)>/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("closes a dangling <a> when a link is cut by the per-paragraph budget", () => {
    // A long run of text then one very long link, so the budget cut lands
    // inside the anchor. The output must not leave an unbalanced/dangling <a>.
    const filler = "word ".repeat(900); // ~4500 chars of plain text
    const longUrl = "https://x.com/" + "a".repeat(200);
    const out = renderGoogleChatMessage([
      section(`${filler}[clickable](${longUrl})`),
    ]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html = tp.textParagraph.text;

    expect(html.length).toBeLessThanOrEqual(GCHAT_LIMITS.textParagraph);
    // Anchors are balanced: every `<a …>` has a matching `</a>`.
    const aOpens = (html.match(/<a\b[^>]*>/g) ?? []).length;
    const aCloses = (html.match(/<\/a>/g) ?? []).length;
    expect(aOpens).toBe(aCloses);
    // And no trailing unterminated `<…`.
    expect(html.lastIndexOf("<")).toBeLessThanOrEqual(html.lastIndexOf(">"));
  });

  it("does not collapse a single over-long link to just an ellipsis", () => {
    // The whole paragraph is one link longer than the budget; the cut lands
    // inside the opening tag. Rather than emit only "…", fall back to the
    // (escaped) visible text so the content survives.
    const longUrl = "https://x.com/" + "a".repeat(5000);
    const out = renderGoogleChatMessage([
      section(`[the visible link text](${longUrl})`),
    ]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html = tp.textParagraph.text;

    expect(html.length).toBeLessThanOrEqual(GCHAT_LIMITS.textParagraph);
    expect(html).not.toBe("…");
    expect(html).toContain("the visible link text");
    // No dangling anchor.
    const aOpens = (html.match(/<a\b[^>]*>/g) ?? []).length;
    const aCloses = (html.match(/<\/a>/g) ?? []).length;
    expect(aOpens).toBe(aCloses);
  });

  it("keeps balanced parens in a link URL (Wikipedia-style) intact in the card href", () => {
    const out = renderGoogleChatMessage([
      section("[wiki](https://en.wikipedia.org/wiki/Foo_(bar))"),
    ]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html = tp.textParagraph.text;

    expect(html).toContain(
      '<a href="https://en.wikipedia.org/wiki/Foo_(bar)">wiki</a>',
    );
    // No stray `)` leaking after the anchor.
    expect(html).not.toContain("</a>)");
  });

  // ── Fix: links are extracted BEFORE the escape/emphasis passes, so `*`/`_` ──
  // inside a URL is never rewritten as <i>/<b> and spliced into the href.
  it("keeps underscores in a link URL verbatim (no <i> in the href)", () => {
    const out = renderGoogleChatMessage([
      section("[doc](https://x.com/path/_foo_/bar)"),
    ]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html = tp.textParagraph.text;

    expect(html).toContain('<a href="https://x.com/path/_foo_/bar">doc</a>');
    // The href must be the EXACT url — no emphasis tags spliced in.
    expect(html).not.toContain("<i>");
  });
  it("keeps asterisks in a link URL verbatim (no <i> in the href)", () => {
    const out = renderGoogleChatMessage([
      section("[doc](https://x.com/p/*a*/b)"),
    ]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html = tp.textParagraph.text;

    expect(html).toContain('<a href="https://x.com/p/*a*/b">doc</a>');
    expect(html).not.toContain("<i>");
  });

  it("gives handler-less buttons bounded, sanitized, distinct fallback ids", () => {
    // Buttons with large, brace/quote-laden values: the FUNCTION id must not
    // carry the value (bounded + opaque), yet remain distinct per button.
    const button = (label: string, value: unknown): ChannelNode => ({
      type: "button",
      props: { value, children: [text(label)] },
    });
    const bigValue = { note: '"'.repeat(500) + "{}[]" };
    const actionsNode: ChannelNode = {
      type: "actions",
      props: { children: [button("One", bigValue), button("Two", bigValue)] },
    };

    const out = renderGoogleChatMessage([actionsNode]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const buttons = widgets.find((w) => w.buttonList !== undefined).buttonList
      .buttons;

    const fnA = buttons[0].onClick.action.function;
    const fnB = buttons[1].onClick.action.function;

    // Bounded + opaque: short, no quotes/braces from the value.
    expect(fnA).toBe("ck-fallback-0");
    expect(fnB).toBe("ck-fallback-1");
    expect(fnA).not.toContain('"');
    expect(fnA).not.toContain("{");
    expect(fnA.length).toBeLessThanOrEqual(32);
    // Distinct per button.
    expect(fnA).not.toBe(fnB);

    // The value is still carried in the parameters, unchanged.
    const valueParam = buttons[0].onClick.action.parameters.find(
      (p: any) => p.key === "value",
    );
    expect(JSON.parse(valueParam.value)).toEqual(bigValue);
  });

  it("wraps a context node's italic text in a single <i> span (no nested <i>)", () => {
    const contextNode: ChannelNode = {
      type: "context",
      props: { children: [text("hello *world* there")] },
    };
    const out = renderGoogleChatMessage([contextNode]);
    const card = (out.cardsV2![0] as any).card;
    const widgets: any[] = card.sections.flatMap((s: any) => s.widgets);
    const tp = widgets.find((w) => w.textParagraph !== undefined);
    const html: string = tp.textParagraph.text;

    // The whole line is a single italic span — no nested/duplicated <i>.
    expect(html).toContain("world");
    expect(html).not.toContain("<i><i>");
    expect((html.match(/<i>/g) ?? []).length).toBe(1);
    expect((html.match(/<\/i>/g) ?? []).length).toBe(1);
    expect(html.startsWith("<i>")).toBe(true);
    expect(html.endsWith("</i>")).toBe(true);
  });

  it("converts markdown on the non-streamed plain-text path (matches the streaming path)", () => {
    const out = renderGoogleChatMessage([text("hello **bold** world")]);
    expect(out.cardsV2).toBeUndefined();
    // markdownToChat turns **bold** into *bold* (Chat's bold form), not literal.
    expect(out.text).toBe("hello *bold* world");
    expect(out.text).not.toContain("**bold**");
  });

  it("converts a markdown link on the plain-text path to Chat <url|text> form", () => {
    const out = renderGoogleChatMessage([text("see [t](https://x.com) now")]);
    expect(out.cardsV2).toBeUndefined();
    expect(out.text).toBe("see <https://x.com|t> now");
  });

  it("returns a plain text body (no empty-widgets section) when non-plain-text IR produces zero widgets", () => {
    // `divider`/unknown wrapping that yields no widgets — here an unknown node
    // type means renderNodeWidgets emits nothing, but the IR is not plain text
    // so the fast path is skipped.
    const unknownNode: ChannelNode = {
      type: "totally-unknown-node" as any,
      props: { children: [] },
    };

    const out = renderGoogleChatMessage([unknownNode]);

    // Must NOT emit a card with an empty `widgets: []` section.
    expect(out.cardsV2).toBeUndefined();
    expect(typeof out.text).toBe("string");
  });
});

describe("renderGoogleChatMessage: current component vocabulary", () => {
  const t = (value: string): ChannelNode => ({
    type: "text",
    props: { value },
  });
  const card = (body: { cardsV2?: unknown[] }) =>
    (body.cardsV2![0] as { card: { sections: { widgets: any[] }[] } }).card;

  it("uses the action id as the function, with actionId and value parameters", () => {
    const body = renderGoogleChatMessage([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "button",
              props: { onClick: { id: "ck:1" }, value: 7, children: [t("Go")] },
            },
          ],
        },
      },
    ]);
    const button = card(body).sections[0]!.widgets[0].buttonList.buttons[0];
    expect(button.onClick.action).toEqual({
      function: "ck:1",
      parameters: [
        { key: "actionId", value: "ck:1" },
        { key: "value", value: "7" },
      ],
    });
  });

  it("uses endpointUrl as the function on add-on apps", () => {
    const body = renderGoogleChatMessage(
      [
        {
          type: "actions",
          props: {
            children: [
              {
                type: "button",
                props: { onClick: { id: "ck:1" }, children: [t("Go")] },
              },
            ],
          },
        },
      ],
      { endpointUrl: "https://bot.example.com/chat" },
    );
    const action =
      card(body).sections[0]!.widgets[0].buttonList.buttons[0].onClick.action;
    expect(action.function).toBe("https://bot.example.com/chat");
    expect(action.parameters).toEqual([{ key: "actionId", value: "ck:1" }]);
  });

  it("renders a link button as openLink and drops unsafe schemes", () => {
    const body = renderGoogleChatMessage([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "button",
              props: { url: "https://example.com", children: [t("Docs")] },
            },
            {
              type: "button",
              props: { url: "javascript:alert(1)", children: [t("Bad")] },
            },
          ],
        },
      },
    ]);
    const buttons = card(body).sections[0]!.widgets[0].buttonList.buttons;
    expect(buttons).toEqual([
      { text: "Docs", onClick: { openLink: { url: "https://example.com" } } },
    ]);
  });

  it("renders a select as a dropdown that reports its choice on change", () => {
    const body = renderGoogleChatMessage([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "select",
              props: {
                onSelect: { id: "ck:sel" },
                placeholder: "Pick a color",
                options: [
                  { label: "Red", value: "red" },
                  { label: "Blue", value: "blue" },
                ],
              },
            },
          ],
        },
      },
    ]);
    const select = card(body).sections[0]!.widgets[0].selectionInput;
    expect(select).toMatchObject({
      name: "ck:sel",
      label: "Pick a color",
      type: "DROPDOWN",
      items: [
        { text: "Red", value: "red", selected: false },
        { text: "Blue", value: "blue", selected: false },
      ],
      onChangeAction: {
        function: "ck:sel",
        parameters: [{ key: "actionId", value: "ck:sel" }],
      },
    });
  });

  it("puts a field label in topLabel", () => {
    const body = renderGoogleChatMessage([
      {
        type: "fields",
        props: {
          children: [
            {
              type: "field",
              props: { label: "Status", children: [t("Online")] },
            },
          ],
        },
      },
    ]);
    expect(card(body).sections[0]!.widgets[0]).toEqual({
      decoratedText: { topLabel: "Status", text: "Online" },
    });
  });

  it("renders a table as an aligned monospace block", () => {
    const cell = (v: string): ChannelNode => ({
      type: "cell",
      props: { children: [t(v)] },
    });
    const body = renderGoogleChatMessage([
      {
        type: "table",
        props: {
          columns: [{ header: "Name" }, { header: "Qty" }],
          children: [
            { type: "row", props: { children: [cell("apple"), cell("3")] } },
          ],
        },
      },
    ]);
    expect(card(body).sections[0]!.widgets[0].textParagraph.text).toBe(
      '<font face="monospace">Name   Qty<br>-----  ---<br>apple  3</font>',
    );
  });

  it("sends <Message fallbackText> as the message text", () => {
    const body = renderGoogleChatMessage([
      {
        type: "message",
        props: {
          fallbackText: "Deploy finished",
          children: [
            { type: "header", props: { children: [t("Deploy")] } },
            { type: "divider", props: {} },
          ],
        },
      },
    ]);
    expect(body.text).toBe("Deploy finished");
  });
});

describe("renderGoogleChatMessage: images", () => {
  it("keeps only absolute HTTPS image URLs", () => {
    const image = (url: string): ChannelNode => ({
      type: "image",
      props: { url, alt: "chart" },
    });
    const body = renderGoogleChatMessage([
      image("https://example.com/a.png"),
      image("http://example.com/b.png"),
      image("/relative.png"),
      image("//example.com/c.png"),
    ]);
    const widgets = (
      body.cardsV2![0] as { card: { sections: { widgets: unknown[] }[] } }
    ).card.sections[0]!.widgets;
    expect(widgets).toEqual([
      { image: { imageUrl: "https://example.com/a.png", altText: "chart" } },
    ]);
  });
});
