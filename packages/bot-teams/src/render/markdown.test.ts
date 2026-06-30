import { describe, it, expect } from "vitest";
import type { BotNode } from "@copilotkit/bot-ui";
import { renderTeamsMarkdown } from "./markdown.js";

const text = (value: string): BotNode => ({ type: "text", props: { value } });

describe("renderTeamsMarkdown", () => {
  it("renders a bare text node", () => {
    expect(renderTeamsMarkdown([text("Echo: hi")])).toBe("Echo: hi");
  });

  it("renders a header as bold", () => {
    const ir: BotNode[] = [
      { type: "header", props: { children: [text("Title")] } },
    ];
    expect(renderTeamsMarkdown(ir)).toBe("**Title**");
  });

  it("renders a divider as a rule", () => {
    expect(renderTeamsMarkdown([{ type: "divider", props: {} }])).toBe("---");
  });

  it("joins a message container's children with blank lines", () => {
    const ir: BotNode[] = [
      {
        type: "message",
        props: {
          children: [
            { type: "header", props: { children: [text("Status")] } },
            { type: "section", props: { children: [text("All good.")] } },
          ],
        },
      },
    ];
    expect(renderTeamsMarkdown(ir)).toBe("**Status**\n\nAll good.");
  });

  it("renders context children as emphasized lines", () => {
    const ir: BotNode[] = [
      { type: "context", props: { children: [text("fyi")] } },
    ];
    expect(renderTeamsMarkdown(ir)).toBe("_fyi_");
  });

  it("returns an empty string for an empty tree", () => {
    expect(renderTeamsMarkdown([])).toBe("");
  });

  it("renders a <Table> as a GFM pipe-table fallback", () => {
    const cell = (v: string): BotNode => ({
      type: "cell",
      props: { children: [text(v)] },
    });
    const ir: BotNode[] = [
      {
        type: "table",
        props: {
          columns: [{ header: "Name" }, { header: "Count", align: "right" }],
          children: [
            { type: "row", props: { children: [cell("Bugs"), cell("3")] } },
          ],
        },
      },
    ];
    expect(renderTeamsMarkdown(ir)).toBe(
      "| Name | Count |\n| --- | ---: |\n| Bugs | 3 |",
    );
  });
});
