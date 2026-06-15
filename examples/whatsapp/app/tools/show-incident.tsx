/**
 * `show_incident` — an interactive incident card with Acknowledge / Escalate
 * WhatsApp reply buttons (≤3 buttons is the WhatsApp limit). The buttons carry
 * inline `onClick` handlers that are FIRE-AND-FORGET: the bot dispatches the
 * handler on click with no waiter. WhatsApp messages cannot be edited, so the
 * handlers POST a new acknowledgement/escalation message rather than updating
 * the original card in place.
 */
import { z } from "zod";
import {
  Message,
  Header,
  Section,
  Context,
  Actions,
  Button,
  type InteractionContext,
} from "@copilotkit/bot-ui";
import { defineBotTool } from "@copilotkit/bot";

const incidentSchema = z.object({
  id: z.string().describe("Incident identifier, e.g. 'INC-4821'."),
  title: z.string().describe("Short incident title."),
  severity: z
    .enum(["SEV1", "SEV2", "SEV3"])
    .describe("Severity — drives the card's accent colour."),
  summary: z.string().describe("One-paragraph summary of what's happening."),
});

type IncidentProps = z.infer<typeof incidentSchema>;

export function IncidentCard({ id, title, severity, summary }: IncidentProps) {
  const accent =
    severity === "SEV1"
      ? "#EB5757"
      : severity === "SEV2"
        ? "#F2994A"
        : "#5E6AD2";
  return (
    <Message accent={accent}>
      <Header>{`🚨 ${severity} · ${title}`}</Header>
      <Section>{summary}</Section>
      <Context>{`Incident ${id}`}</Context>
      <Actions>
        <Button
          value={{ action: "ack", id }}
          style="primary"
          onClick={async ({ thread, user }: InteractionContext) => {
            // WhatsApp can't edit messages, so post a fresh confirmation.
            await thread.post(
              `✅ Acknowledged *${title}* — by ${user?.name ?? user?.id ?? "someone"}.`,
            );
          }}
        >
          Acknowledge
        </Button>
        <Button
          value={{ action: "escalate", id }}
          style="danger"
          onClick={async ({ thread }: InteractionContext) => {
            await thread.post(
              `🔺 Escalating *${title}* — paging the next on-call.`,
            );
          }}
        >
          Escalate
        </Button>
      </Actions>
    </Message>
  );
}

export const showIncidentTool = defineBotTool({
  name: "show_incident",
  description:
    "Render an interactive incident card with Acknowledge/Escalate reply " +
    "buttons. Pass id, title, severity (SEV1/SEV2/SEV3) and a one-paragraph " +
    "summary. Clicking Acknowledge posts an acknowledgement; clicking " +
    "Escalate posts a paging notice.",
  parameters: incidentSchema,
  async handler(props, { thread }) {
    await thread.post(<IncidentCard {...props} />);
    return "Displayed the incident card to the user.";
  },
});
