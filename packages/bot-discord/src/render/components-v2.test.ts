import { describe, it, expect } from "vitest";
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
});
