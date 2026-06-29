import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import type { BotNode } from "@copilotkit/bot-ui";
import { renderAdaptiveCard } from "@copilotkit/bot-teams";
import { confirmWriteTool } from "../index.js";

/** A fake thread whose `awaitChoice` records the posted UI and returns a fixed choice. */
function fakeThread(choice: unknown) {
  const awaited: unknown[] = [];
  const thread = {
    async awaitChoice(ui: unknown) {
      awaited.push(ui);
      return choice;
    },
  };
  return { thread, awaited };
}

describe("confirm_write tool (Teams)", () => {
  it("posts a ConfirmAction card and returns approval when the user approves", async () => {
    const { thread, awaited } = fakeThread({ confirmed: true });

    const result = await confirmWriteTool.handler(
      { action: "Send announcement", detail: "Deploy v1.4.2 is live." },
      { thread, platform: "teams" } as never,
    );

    expect(result).toBe("The user APPROVED. Proceed with send_announcement.");

    // The posted UI renders to an Adaptive Card whose header carries the action.
    expect(awaited).toHaveLength(1);
    const card = renderAdaptiveCard(renderToIR(awaited[0] as BotNode));
    expect(card.type).toBe("AdaptiveCard");
    const header = card.body[0] as { type: string; text: string } | undefined;
    expect(header?.type).toBe("TextBlock");
    expect(header?.text).toContain("Send announcement");
  });

  it("returns a decline message when the user rejects", async () => {
    const { thread } = fakeThread({ confirmed: false });

    const result = await confirmWriteTool.handler(
      { action: "Send announcement" },
      { thread, platform: "teams" } as never,
    );

    expect(result).toBe(
      "The user DECLINED. Do not send; acknowledge and stop.",
    );
  });
});
