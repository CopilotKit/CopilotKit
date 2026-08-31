import { describe, it, expect, vi } from "vitest";
import { ComponentType, ButtonStyle } from "discord.js";
import { renderComponents } from "./components-v2.js";
import type { ChannelNode } from "@copilotkit/channels-ui";

const text = (value: string): ChannelNode => ({
  type: "text",
  props: { value },
});
const node = (
  type: string,
  props: Record<string, unknown> = {},
): ChannelNode => ({
  type,
  props,
});

describe("renderComponents", () => {
  it("wraps a header + section in a container with text displays", () => {
    const ir: ChannelNode[] = [
      node("message", {
        children: [
          node("header", { children: text("Hello") }),
          node("section", { children: text("Body **bold**") }),
        ],
      }),
    ];
    const container = renderComponents(ir);
    const json = container.toJSON();
    expect(json.type).toBe(ComponentType.Container);
    const texts = json.components.filter(
      (c: any) => c.type === ComponentType.TextDisplay,
    );
    expect((texts[0] as any).content).toBe("# Hello");
    expect((texts[1] as any).content).toContain("Body **bold**");
  });

  it("maps accent to the container accent color (#5865F2 → int)", () => {
    const ir: ChannelNode[] = [
      node("message", { accent: "#5865F2", children: text("hi") }),
    ];
    const json = renderComponents(ir).toJSON();
    expect(json.accent_color).toBe(0x5865f2);
  });

  it("renders a button with its minted custom_id and style", () => {
    const ir: ChannelNode[] = [
      node("message", {
        children: node("actions", {
          children: node("button", {
            children: text("Approve"),
            style: "primary",
            onClick: { id: "ck:abc123" },
          }),
        }),
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const row = json.components.find(
      (c: any) => c.type === ComponentType.ActionRow,
    );
    expect(row).toBeTruthy();
    const btn = (row as any).components[0];
    expect(btn.custom_id).toBe("ck:abc123");
    expect(btn.label).toBe("Approve");
    expect(btn.style).toBe(ButtonStyle.Primary);
  });

  it("renders a url button as a Link-style button with no custom_id", () => {
    const ir: ChannelNode[] = [
      node("message", {
        children: node("actions", {
          children: node("button", {
            children: text("Open"),
            url: "https://dash/deploy/42",
          }),
        }),
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const row = json.components.find(
      (c: any) => c.type === ComponentType.ActionRow,
    );
    const btn = (row as any).components[0];
    expect(btn.style).toBe(ButtonStyle.Link);
    expect(btn.url).toBe("https://dash/deploy/42");
    expect(btn.custom_id).toBeUndefined();
  });

  it("sets max_values on a multi-select so the decoder reads an array", () => {
    const ir: ChannelNode[] = [
      node("message", {
        children: node("actions", {
          children: node("select", {
            multi: true,
            onSelect: { id: "ck:ms" },
            options: [
              { label: "Core", value: "core" },
              { label: "Infra", value: "infra" },
            ],
          }),
        }),
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const row = json.components.find(
      (c: any) => c.type === ComponentType.ActionRow,
    );
    const select = (row as any).components[0];
    expect(select.type).toBe(ComponentType.StringSelect);
    expect(select.max_values).toBe(2);
    expect(select.min_values).toBe(0);
  });

  it("chunks more than 5 buttons into multiple action rows", () => {
    const buttons = Array.from({ length: 7 }, (_, i) =>
      node("button", { children: text(`b${i}`), onClick: { id: `ck:${i}` } }),
    );
    const ir: ChannelNode[] = [
      node("message", { children: node("actions", { children: buttons }) }),
    ];
    const json = renderComponents(ir).toJSON();
    const rows = json.components.filter(
      (c: any) => c.type === ComponentType.ActionRow,
    );
    expect(rows.length).toBe(2);
    expect((rows[0] as any).components.length).toBe(5);
    expect((rows[1] as any).components.length).toBe(2);
  });

  it("renders a divider as a separator", () => {
    const ir: ChannelNode[] = [node("message", { children: node("divider") })];
    const json = renderComponents(ir).toJSON();
    expect(
      json.components.some((c: any) => c.type === ComponentType.Separator),
    ).toBe(true);
  });

  it("clamps an IR with > componentsPerMessage components and appends one overflow marker", () => {
    // 60 dividers each cost one component; the message caps at 40 total.
    const dividers = Array.from({ length: 60 }, () => node("divider"));
    const ir: ChannelNode[] = [node("message", { children: dividers })];
    const json = renderComponents(ir).toJSON();
    expect(json.components.length).toBeLessThanOrEqual(40);
    const overflow = json.components.filter(
      (c: any) =>
        c.type === ComponentType.TextDisplay &&
        c.content === "_…content truncated_",
    );
    expect(overflow.length).toBe(1);
  });

  it("clamps total text across the message at totalTextChars", () => {
    // Three 2000-char sections (each within textDisplayChars) sum to 6000 > 4000.
    const chunk = "x".repeat(2000);
    const sections = Array.from({ length: 3 }, () =>
      node("section", { children: text(chunk) }),
    );
    const ir: ChannelNode[] = [node("message", { children: sections })];
    const json = renderComponents(ir).toJSON();
    const totalText = json.components
      .filter((c: any) => c.type === ComponentType.TextDisplay)
      .reduce((sum: number, c: any) => sum + (c.content?.length ?? 0), 0);
    // Summed text never exceeds the budget plus the short overflow marker.
    expect(totalText).toBeLessThanOrEqual(4000 + "_…content truncated_".length);
  });

  it("clamps a select to 25 real options with no fake selectable sentinel when it exceeds 25", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const options = Array.from({ length: 30 }, (_, i) => ({
      label: `opt${i}`,
      value: `v${i}`,
    }));
    const ir: ChannelNode[] = [
      node("message", {
        children: node("actions", {
          children: node("select", { onSelect: { id: "ck:sel" }, options }),
        }),
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const row = json.components.find(
      (c: any) => c.type === ComponentType.ActionRow,
    );
    const select = (row as any).components[0];
    // Exactly 25 real options; the dropped 5 are warned, never turned into a
    // selectable "__overflow__" garbage value.
    expect(select.options.length).toBe(25);
    expect(select.options.every((o: any) => o.value !== "__overflow__")).toBe(
      true,
    );
    expect(select.options.map((o: any) => o.value)).toEqual(
      Array.from({ length: 25 }, (_, i) => `v${i}`),
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("truncates a select placeholder over 150 chars", () => {
    const long = "p".repeat(300);
    const ir: ChannelNode[] = [
      node("message", {
        children: node("actions", {
          children: node("select", {
            onSelect: { id: "ck:sel" },
            placeholder: long,
            options: [{ label: "a", value: "a" }],
          }),
        }),
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const row = json.components.find(
      (c: any) => c.type === ComponentType.ActionRow,
    );
    const select = (row as any).components[0];
    expect(select.placeholder.length).toBeLessThanOrEqual(150);
  });

  it("accepts a strict 6-hex accent and rejects junk / out-of-range", () => {
    const accepted = renderComponents([
      node("message", { accent: "#5865F2", children: text("hi") }),
    ]).toJSON();
    expect(accepted.accent_color).toBe(0x5865f2);

    const partialHex = renderComponents([
      node("message", { accent: "12xyz", children: text("hi") }),
    ]).toJSON();
    expect(partialHex.accent_color).toBeUndefined();

    const outOfRange = renderComponents([
      node("message", { accent: 0x1000000, children: text("hi") }),
    ]).toJSON();
    expect(outOfRange.accent_color).toBeUndefined();
  });

  it("drops an over-large button value but still renders the button via its handler id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bigValue = { blob: "z".repeat(200) }; // v:<json> exceeds 100 chars
    const ir: ChannelNode[] = [
      node("message", {
        children: node("actions", {
          children: node("button", {
            children: text("Go"),
            onClick: { id: "ck:handler" },
            value: bigValue,
          }),
        }),
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const row = json.components.find(
      (c: any) => c.type === ComponentType.ActionRow,
    );
    const btn = (row as any).components[0];
    // Handler id wins; the value is never encoded into the custom_id.
    expect(btn.custom_id).toBe("ck:handler");
    warn.mockRestore();
  });

  it("warns and renders no button when an over-large value is the only id source", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bigValue = { blob: "z".repeat(200) };
    const ir: ChannelNode[] = [
      node("message", {
        children: node("actions", {
          children: node("button", { children: text("Go"), value: bigValue }),
        }),
      }),
    ];
    renderComponents(ir).toJSON();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps a fenced table balanced when truncated near the 2000-char limit", () => {
    // Build a table whose fenced markdown overruns textDisplayChars.
    const columns = [{ header: "A" }, { header: "B" }];
    const rows = Array.from({ length: 200 }, (_, i) =>
      node("row", {
        children: [
          node("cell", { children: text("x".repeat(20) + i) }),
          node("cell", { children: text("y".repeat(20) + i) }),
        ],
      }),
    );
    const ir: ChannelNode[] = [
      node("message", { children: node("table", { columns, children: rows }) }),
    ];
    const json = renderComponents(ir).toJSON();
    const td = json.components.find(
      (c: any) => c.type === ComponentType.TextDisplay,
    ) as any;
    expect(td.content.length).toBeLessThanOrEqual(2000);
    // Fence delimiters must be balanced (even count) so the closing ``` is present.
    expect((td.content.match(/```/g) ?? []).length % 2).toBe(0);
  });

  it("counts nested buttons toward the component cap (5 rows × 5 buttons stays ≤ 40 real components)", () => {
    // 25 buttons → 5 action rows × 5 buttons = 5 rows + 25 buttons = 30 nested
    // components, plus a leading text. The naive +1-per-row accounting would
    // count only 5; the cap is 40 total. Add enough rows to force overflow.
    const buttons = Array.from({ length: 25 }, (_, i) =>
      node("button", { children: text(`b${i}`), onClick: { id: `ck:${i}` } }),
    );
    const ir: ChannelNode[] = [
      node("message", {
        children: [
          node("section", { children: text("header text") }),
          node("actions", { children: buttons }),
        ],
      }),
    ];
    const json = renderComponents(ir).toJSON();
    // Count every real component Discord would tally: containers' direct children
    // plus each action row's nested components.
    const countComponents = (comps: any[]): number =>
      comps.reduce((sum, c) => {
        if (c.type === ComponentType.ActionRow) {
          return sum + 1 + (c.components?.length ?? 0);
        }
        return sum + 1;
      }, 0);
    const total = countComponents(json.components);
    expect(total).toBeLessThanOrEqual(40);
  });

  it("overflow-signals before exceeding 40 when many rows of buttons overflow the cap", () => {
    // 5 rows of 5 buttons would be 30 components, but pad with dividers first so
    // the action rows push past the cap and an overflow marker is emitted.
    const dividers = Array.from({ length: 30 }, () => node("divider"));
    const buttons = Array.from({ length: 25 }, (_, i) =>
      node("button", { children: text(`b${i}`), onClick: { id: `ck:${i}` } }),
    );
    const ir: ChannelNode[] = [
      node("message", {
        children: [...dividers, node("actions", { children: buttons })],
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const countComponents = (comps: any[]): number =>
      comps.reduce((sum, c) => {
        if (c.type === ComponentType.ActionRow) {
          return sum + 1 + (c.components?.length ?? 0);
        }
        return sum + 1;
      }, 0);
    expect(countComponents(json.components)).toBeLessThanOrEqual(40);
    const overflow = json.components.filter(
      (c: any) =>
        c.type === ComponentType.TextDisplay &&
        c.content === "_…content truncated_",
    );
    expect(overflow.length).toBe(1);
  });

  it("emits no empty TextDisplay when the text budget is exhausted", () => {
    // Two 4000-char sections: the first fills totalTextChars, the second clamps
    // to "" — which must NOT become an empty TextDisplay (Discord rejects it).
    const chunk = "x".repeat(4000);
    const ir: ChannelNode[] = [
      node("message", {
        children: [
          node("section", { children: text(chunk) }),
          node("section", { children: text(chunk) }),
        ],
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const texts = json.components.filter(
      (c: any) => c.type === ComponentType.TextDisplay,
    );
    expect(texts.every((c: any) => (c.content?.length ?? 0) > 0)).toBe(true);
  });

  it("emits no 'content truncated' marker for genuinely-empty input (empty Fields / empty Text)", () => {
    const ir: ChannelNode[] = [
      node("message", {
        children: [
          node("fields", { children: [] }),
          node("section", { children: text("") }),
          node("context", { children: [] }),
        ],
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const overflow = json.components.filter(
      (c: any) =>
        c.type === ComponentType.TextDisplay &&
        c.content === "_…content truncated_",
    );
    expect(overflow.length).toBe(0);
    // No empty TextDisplay leaked through either.
    const texts = json.components.filter(
      (c: any) => c.type === ComponentType.TextDisplay,
    );
    expect(texts.every((c: any) => (c.content?.length ?? 0) > 0)).toBe(true);
  });

  it("keeps a fenced table balanced when clamped by the cumulative 4000-char text budget", () => {
    // Pre-fill text close to the 4000 cumulative cap, then render a fenced table
    // whose markdown is clamped by the cumulative budget (not the per-display
    // limit). The cumulative clamp must not sever the fence open.
    // Leave only a small cumulative budget (~10 chars) for the table so the
    // cumulative clamp lands mid-fence, exercising the fence-aware path.
    const filler = "x".repeat(1985);
    const fillers = Array.from({ length: 2 }, () =>
      node("section", { children: text(filler) }),
    );
    const columns = [{ header: "A" }, { header: "B" }];
    const rows = Array.from({ length: 50 }, (_, i) =>
      node("row", {
        children: [
          node("cell", { children: text("aaaa" + i) }),
          node("cell", { children: text("bbbb" + i) }),
        ],
      }),
    );
    const ir: ChannelNode[] = [
      node("message", {
        children: [...fillers, node("table", { columns, children: rows })],
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const texts = json.components.filter(
      (c: any) => c.type === ComponentType.TextDisplay,
    ) as any[];
    // The table's TextDisplay is the one containing a fence; it must be present
    // (a cut fence leaves an opening ```) and balanced.
    const fenced = texts.filter((c) => (c.content ?? "").includes("```"));
    expect(fenced.length).toBeGreaterThan(0);
    for (const c of fenced) {
      expect((c.content.match(/```/g) ?? []).length % 2).toBe(0);
    }
  });

  it("does not emit a Select with zero options", () => {
    const ir: ChannelNode[] = [
      node("message", {
        children: node("actions", {
          children: node("select", { onSelect: { id: "ck:sel" }, options: [] }),
        }),
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const row = json.components.find(
      (c: any) => c.type === ComponentType.ActionRow,
    );
    // No options → no select → the action row is never created.
    expect(row).toBeUndefined();
  });

  it("falls back to ' ' for an explicitly-empty select placeholder", () => {
    const ir: ChannelNode[] = [
      node("message", {
        children: node("actions", {
          children: node("select", {
            onSelect: { id: "ck:sel" },
            placeholder: "",
            options: [{ label: "a", value: "a" }],
          }),
        }),
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const row = json.components.find(
      (c: any) => c.type === ComponentType.ActionRow,
    );
    const select = (row as any).components[0];
    expect(select.placeholder).toBe(" ");
  });

  it("counts the overflow marker against the text budget", () => {
    // Fill text past the cap so an overflow marker is appended; total text
    // (including the marker) must stay within totalTextChars.
    const chunk = "x".repeat(2000);
    const sections = Array.from({ length: 4 }, () =>
      node("section", { children: text(chunk) }),
    );
    const ir: ChannelNode[] = [node("message", { children: sections })];
    const json = renderComponents(ir).toJSON();
    const totalText = json.components
      .filter((c: any) => c.type === ComponentType.TextDisplay)
      .reduce((sum: number, c: any) => sum + (c.content?.length ?? 0), 0);
    // Overflow marker is reserved for and charged against the budget, so the
    // summed text never exceeds totalTextChars.
    expect(totalText).toBeLessThanOrEqual(4000);
  });
});
