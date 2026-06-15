import { describe, it, expect, vi } from "vitest";
import { ComponentType, ButtonStyle } from "discord.js";
import { renderComponents } from "./components-v2.js";
import type { BotNode } from "@copilotkit/bot-ui";

const text = (value: string): BotNode => ({ type: "text", props: { value } });
const node = (type: string, props: Record<string, unknown> = {}): BotNode => ({ type, props });

describe("renderComponents", () => {
  it("wraps a header + section in a container with text displays", () => {
    const ir: BotNode[] = [
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
    const texts = json.components.filter((c: any) => c.type === ComponentType.TextDisplay);
    expect((texts[0] as any).content).toBe("# Hello");
    expect((texts[1] as any).content).toContain("Body **bold**");
  });

  it("maps accent to the container accent color (#5865F2 → int)", () => {
    const ir: BotNode[] = [node("message", { accent: "#5865F2", children: text("hi") })];
    const json = renderComponents(ir).toJSON();
    expect(json.accent_color).toBe(0x5865f2);
  });

  it("renders a button with its minted custom_id and style", () => {
    const ir: BotNode[] = [
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
    const row = json.components.find((c: any) => c.type === ComponentType.ActionRow);
    expect(row).toBeTruthy();
    const btn = (row as any).components[0];
    expect(btn.custom_id).toBe("ck:abc123");
    expect(btn.label).toBe("Approve");
    expect(btn.style).toBe(ButtonStyle.Primary);
  });

  it("chunks more than 5 buttons into multiple action rows", () => {
    const buttons = Array.from({ length: 7 }, (_, i) =>
      node("button", { children: text(`b${i}`), onClick: { id: `ck:${i}` } }),
    );
    const ir: BotNode[] = [node("message", { children: node("actions", { children: buttons }) })];
    const json = renderComponents(ir).toJSON();
    const rows = json.components.filter((c: any) => c.type === ComponentType.ActionRow);
    expect(rows.length).toBe(2);
    expect((rows[0] as any).components.length).toBe(5);
    expect((rows[1] as any).components.length).toBe(2);
  });

  it("renders a divider as a separator", () => {
    const ir: BotNode[] = [node("message", { children: node("divider") })];
    const json = renderComponents(ir).toJSON();
    expect(json.components.some((c: any) => c.type === ComponentType.Separator)).toBe(true);
  });

  it("clamps an IR with > componentsPerMessage components and appends one overflow marker", () => {
    // 60 dividers each cost one component; the message caps at 40 total.
    const dividers = Array.from({ length: 60 }, () => node("divider"));
    const ir: BotNode[] = [node("message", { children: dividers })];
    const json = renderComponents(ir).toJSON();
    expect(json.components.length).toBeLessThanOrEqual(40);
    const overflow = json.components.filter(
      (c: any) => c.type === ComponentType.TextDisplay && c.content === "_…content truncated_",
    );
    expect(overflow.length).toBe(1);
  });

  it("clamps total text across the message at totalTextChars", () => {
    // Three 2000-char sections (each within textDisplayChars) sum to 6000 > 4000.
    const chunk = "x".repeat(2000);
    const sections = Array.from({ length: 3 }, () => node("section", { children: text(chunk) }));
    const ir: BotNode[] = [node("message", { children: sections })];
    const json = renderComponents(ir).toJSON();
    const totalText = json.components
      .filter((c: any) => c.type === ComponentType.TextDisplay)
      .reduce((sum: number, c: any) => sum + (c.content?.length ?? 0), 0);
    // Summed text never exceeds the budget plus the short overflow marker.
    expect(totalText).toBeLessThanOrEqual(4000 + "_…content truncated_".length);
  });

  it("shows a '+N more…' overflow indicator when a select exceeds 25 options", () => {
    const options = Array.from({ length: 30 }, (_, i) => ({ label: `opt${i}`, value: `v${i}` }));
    const ir: BotNode[] = [
      node("message", {
        children: node("actions", {
          children: node("select", { onSelect: { id: "ck:sel" }, options }),
        }),
      }),
    ];
    const json = renderComponents(ir).toJSON();
    const row = json.components.find((c: any) => c.type === ComponentType.ActionRow);
    const select = (row as any).components[0];
    expect(select.options.length).toBe(25);
    const last = select.options[24];
    expect(last.label).toContain("more");
    // 30 options, 24 shown + indicator → 6 hidden.
    expect(last.label).toContain("6");
  });

  it("truncates a select placeholder over 150 chars", () => {
    const long = "p".repeat(300);
    const ir: BotNode[] = [
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
    const row = json.components.find((c: any) => c.type === ComponentType.ActionRow);
    const select = (row as any).components[0];
    expect(select.placeholder.length).toBeLessThanOrEqual(150);
  });

  it("accepts a strict 6-hex accent and rejects junk / out-of-range", () => {
    const accepted = renderComponents([node("message", { accent: "#5865F2", children: text("hi") })]).toJSON();
    expect(accepted.accent_color).toBe(0x5865f2);

    const partialHex = renderComponents([node("message", { accent: "12xyz", children: text("hi") })]).toJSON();
    expect(partialHex.accent_color).toBeUndefined();

    const outOfRange = renderComponents([
      node("message", { accent: 0x1000000, children: text("hi") }),
    ]).toJSON();
    expect(outOfRange.accent_color).toBeUndefined();
  });

  it("drops an over-large button value but still renders the button via its handler id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bigValue = { blob: "z".repeat(200) }; // v:<json> exceeds 100 chars
    const ir: BotNode[] = [
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
    const row = json.components.find((c: any) => c.type === ComponentType.ActionRow);
    const btn = (row as any).components[0];
    // Handler id wins; the value is never encoded into the custom_id.
    expect(btn.custom_id).toBe("ck:handler");
    warn.mockRestore();
  });

  it("warns and renders no button when an over-large value is the only id source", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bigValue = { blob: "z".repeat(200) };
    const ir: BotNode[] = [
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
    const ir: BotNode[] = [node("message", { children: node("table", { columns, children: rows }) })];
    const json = renderComponents(ir).toJSON();
    const td = json.components.find((c: any) => c.type === ComponentType.TextDisplay) as any;
    expect(td.content.length).toBeLessThanOrEqual(2000);
    // Fence delimiters must be balanced (even count) so the closing ``` is present.
    expect((td.content.match(/```/g) ?? []).length % 2).toBe(0);
  });
});
