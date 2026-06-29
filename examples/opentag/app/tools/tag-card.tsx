/**
 * `tag_card` render-tool — the agent-facing wrapper that posts the finished
 * `<TagCard>` to the thread. The agent calls it AFTER `confirm_tag` is approved,
 * to show the tag that was applied.
 *
 * A render-tool is just a `BotTool` whose handler renders a JSX component and
 * posts it: the agent calls the tool, the handler draws the card.
 */
import { defineBotTool } from "@copilotkit/bot";
import { TagCard, tagCardSchema } from "../components/index.js";

export const tagCardTool = defineBotTool({
  name: "tag_card",
  description:
    "Show the tag you've applied as a rich card (colored header, the label, " +
    "and a one-line rationale). Call this ONLY after confirm_tag returns " +
    "approved — it represents the tag being applied.",
  parameters: tagCardSchema,
  async handler(props, { thread }) {
    await thread.post(<TagCard {...props} />);
    return "Displayed the applied tag card to the user.";
  },
});
