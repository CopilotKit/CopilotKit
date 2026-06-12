/**
 * Showcase render-tools — three small JSX `BotTool`s that demonstrate the
 * `@copilotkit/bot-ui` vocabulary end-to-end:
 *
 *  - `show_incident` — an interactive card whose `Acknowledge`/`Escalate`
 *    buttons carry inline `onClick` handlers. These are FIRE-AND-FORGET
 *    interactions (not `awaitChoice`): the bot dispatches the handler on click
 *    with no waiter, so a render-tool can bind live actions directly.
 *  - `show_status` — a `Fields` grid with an accent and bold field labels.
 *  - `show_links` — a `Section` of markdown links (`[label](url)` →
 *    `<url|label>` via the mrkdwn bridge).
 */
import { z } from "zod";
import {
  Message,
  Header,
  Section,
  Context,
  Fields,
  Field,
  Actions,
  Button,
} from "@copilotkit/bot-ui";
import type { InteractionContext } from "@copilotkit/bot-ui";
import { defineBotTool } from "@copilotkit/bot";

// ── show_incident ──────────────────────────────────────────────────────────

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
          onClick={async ({ thread, user, message }: InteractionContext) => {
            await thread.update(
              message.ref,
              <Message accent="#27AE60">
                <Header>{`✅ Acknowledged · ${title}`}</Header>
                <Context>{`Ack'd by ${user?.name ?? user?.id ?? "someone"}`}</Context>
              </Message>,
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
              `:rotating_light: Escalating *${title}* — paging the next on-call.`,
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
    "Render an interactive incident card with Acknowledge/Escalate buttons. " +
    "Pass id, title, severity (SEV1/SEV2/SEV3) and a one-paragraph summary. " +
    "The accent colour reflects severity; clicking Acknowledge updates the " +
    "card in place, clicking Escalate posts a paging notice.",
  parameters: incidentSchema,
  async handler(props, { thread }) {
    await thread.post(<IncidentCard {...props} />);
    return "Posted the incident card to the user.";
  },
});

// ── show_status ────────────────────────────────────────────────────────────

const statusSchema = z.object({
  heading: z.string().describe("Card heading, e.g. 'Service health'."),
  fields: z
    .array(
      z.object({
        label: z.string().describe("Field label (rendered bold)."),
        value: z.string().describe("Field value."),
      }),
    )
    .min(1)
    .describe("Label/value pairs laid out as a two-column grid."),
});

type StatusProps = z.infer<typeof statusSchema>;

export function StatusCard({ heading, fields }: StatusProps) {
  return (
    <Message accent="#5E6AD2">
      <Header>{`📊 ${heading}`}</Header>
      <Fields>
        {fields.map((f) => (
          <Field>{`**${f.label}**\n${f.value}`}</Field>
        ))}
      </Fields>
    </Message>
  );
}

export const showStatusTool = defineBotTool({
  name: "show_status",
  description:
    "Render a status card: a heading plus a grid of label/value fields " +
    "(labels shown bold). Use for service health, deploy status, or any set " +
    "of small key/value metrics.",
  parameters: statusSchema,
  async handler(props, { thread }) {
    await thread.post(<StatusCard {...props} />);
    return "Posted the status card to the user.";
  },
});

// ── show_links ─────────────────────────────────────────────────────────────

const linksSchema = z.object({
  heading: z.string().describe("Card heading, e.g. 'Runbooks'."),
  links: z
    .array(
      z.object({
        label: z.string().describe("Link text."),
        url: z.string().describe("Destination URL."),
      }),
    )
    .min(1)
    .describe("Links rendered as a single dot-separated row."),
});

type LinksProps = z.infer<typeof linksSchema>;

export function LinksCard({ heading, links }: LinksProps) {
  // `[label](url)` is rewritten to Slack's `<url|label>` link form by
  // `markdownToMrkdwn`; authoring the raw `<url|label>` here would have its
  // inner text mangled, so we author markdown links instead.
  return (
    <Message>
      <Header>{`🔗 ${heading}`}</Header>
      <Section>
        {links.map((l) => `[${l.label}](${l.url})`).join("  ·  ")}
      </Section>
    </Message>
  );
}

export const showLinksTool = defineBotTool({
  name: "show_links",
  description:
    "Render a card of links: a heading plus a dot-separated row of clickable " +
    "links. Use to surface runbooks, dashboards, or related pages.",
  parameters: linksSchema,
  async handler(props, { thread }) {
    await thread.post(<LinksCard {...props} />);
    return "Posted the links to the user.";
  },
});
