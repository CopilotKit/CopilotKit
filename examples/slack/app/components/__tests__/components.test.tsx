/**
 * Block Kit parity tests for the JSX render components. Each component is a
 * `@copilotkit/bot-ui` `ComponentFn`; we assert the full
 * `renderSlackMessage(renderToIR(<… />))` output — both the `blocks` and the
 * attachment `accent` — against the legacy `defineSlackComponent` shapes.
 *
 * The shared IR→mrkdwn path runs section/field/context text through
 * `markdownToMrkdwn`, so the components author Markdown bold (`**x**`) which
 * the transform rewrites into Slack bold (`*x*`). The block structure,
 * ordering, emoji, dividers, footers and accent colors match the legacy
 * `.ts` output, and the link/label forms below assert the Slack-bold `*…*`
 * the old `defineSlackComponent` code produced.
 *
 * Status/priority glyphs are now platform-neutral unicode (✅ 🔵 🚨 🔴 etc.)
 * so they render identically on both Slack and Telegram.
 */
import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import { renderSlackMessage } from "@copilotkit/bot-slack";
import { renderTelegram } from "@copilotkit/bot-telegram";
import { IssueList } from "../issue-list.js";
import { IssueCard } from "../issue-card.js";
import { PageList } from "../page-list.js";

describe("IssueList component", () => {
  it("renders exactly three blocks: header, a single section with one line per issue, and a count footer", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <IssueList
          heading="Open"
          issues={[
            {
              identifier: "CPK-101",
              title: "Checkout 500s under load",
              url: "https://linear.app/copilotkit/issue/CPK-101",
              state: "In Progress",
              assignee: "Alem",
              priority: "Urgent",
              updated: "2d ago",
            },
            {
              identifier: "CPK-102",
              title: "Login redirect loop",
              url: "https://linear.app/copilotkit/issue/CPK-102",
              state: "Todo",
              assignee: "Sam",
              priority: "High",
              updated: "5h ago",
            },
          ]}
        />,
      ),
    );

    // Fixed three-block layout regardless of issue count.
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "📋  Open" },
    });
    expect(blocks[1]).toMatchObject({ type: "section" });
    expect(blocks[2]).toMatchObject({ type: "context" });

    const section = blocks[1] as { text: { type: string; text: string } };
    expect(section.text.type).toBe("mrkdwn");
    const text = section.text.text;
    // One line per issue, joined by newlines.
    expect(text.split("\n")).toHaveLength(2);
    // Each issue is a linked, bold identifier (Markdown bold → Slack bold).
    expect(text).toContain(
      "<https://linear.app/copilotkit/issue/CPK-101|*CPK-101*>",
    );
    expect(text).toContain(
      "<https://linear.app/copilotkit/issue/CPK-102|*CPK-102*>",
    );
    // Titles, assignees and updated meta are inline on the line.
    expect(text).toContain("Checkout 500s under load");
    expect(text).toContain("Login redirect loop");
    expect(text).toContain("Alem");
    expect(text).toContain("Sam");
    expect(text).toContain("2d ago");
    // In-progress maps to the blue dot.
    expect(text).toContain("🔵");
    // Count footer.
    expect(JSON.stringify(blocks[2])).toContain("2 issues");
    // Hottest priority (Urgent) drives the accent.
    expect(accent).toBe("#EB5757");
  });

  it("caps the section at 15 lines and reports the overflow in the footer", () => {
    const issues = Array.from({ length: 20 }, (_, i) => ({
      identifier: `CPK-${i + 1}`,
      title: `Issue ${i + 1}`,
    }));
    const { blocks } = renderSlackMessage(
      renderToIR(<IssueList heading="Many" issues={issues} />),
    );

    expect(blocks).toHaveLength(3);
    const section = blocks[1] as { text: { text: string } };
    // Only the first 15 issues are rendered.
    expect(section.text.text.split("\n")).toHaveLength(15);
    expect(section.text.text).toContain("*CPK-1*");
    expect(section.text.text).toContain("*CPK-15*");
    expect(section.text.text).not.toContain("*CPK-16*");
    // Footer surfaces the overflow.
    expect(JSON.stringify(blocks[2])).toContain("Showing 15 of 20 issues");
  });

  it("falls back to an emphasized identifier and 'unassigned' when fields are missing", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <IssueList issues={[{ identifier: "CPK-9", title: "No assignee" }]} />,
      ),
    );
    const json = JSON.stringify(blocks);
    // No url → bold identifier, no link wrapper.
    expect(json).toContain("*CPK-9*");
    expect(json).not.toContain("|*CPK-9*>");
    expect(json).toContain("unassigned");
    // No urgent/high priority → Linear purple.
    expect(accent).toBe("#5E6AD2");
  });
});

describe("IssueCard component", () => {
  it("renders a status header, linked title and a fields grid", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <IssueCard
          identifier="CPK-101"
          title="Checkout 500s under load"
          url="https://linear.app/copilotkit/issue/CPK-101"
          state="In Progress"
          assignee="Alem"
          priority="Urgent"
          team="CPK"
        />,
      ),
    );

    const json = JSON.stringify(blocks);
    // Header: in-progress unicode dot + identifier (plain_text, untouched).
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "🔵 CPK-101" },
    });
    // Title section with the linked, bold title.
    expect(json).toContain(
      "<https://linear.app/copilotkit/issue/CPK-101|*Checkout 500s under load*>",
    );
    // A section carries the 2-column metadata grid.
    const fieldsSection = blocks.find(
      (b) => b.type === "section" && "fields" in b && Array.isArray(b.fields),
    ) as { fields: { text: string }[] } | undefined;
    expect(fieldsSection).toBeDefined();
    expect(fieldsSection?.fields).toHaveLength(4);
    expect(json).toContain("*Assignee*\\nAlem");
    expect(json).toContain("*Priority*\\n🚨 Urgent");
    expect(json).toContain("*Status*\\n🔵 In Progress");
    expect(json).toContain("*Team*\\nCPK");
    // Footer: "Open in Linear" link.
    expect(json).toContain(
      "<https://linear.app/copilotkit/issue/CPK-101|Open in Linear →>",
    );
    // Urgent priority drives the accent.
    expect(accent).toBe("#EB5757");
  });

  it("shows a 'Filed' banner and a check header when justCreated", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <IssueCard identifier="CPK-200" title="New bug" justCreated />,
      ),
    );
    const json = JSON.stringify(blocks);
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "✅ CPK-200" },
    });
    expect(json).toContain("✨ Filed in Linear");
    // The Filed banner sits before the fields grid.
    const bannerIdx = blocks.findIndex(
      (b) =>
        b.type === "context" && JSON.stringify(b).includes("Filed in Linear"),
    );
    const fieldsIdx = blocks.findIndex(
      (b) => b.type === "section" && "fields" in b,
    );
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeLessThan(fieldsIdx);
    // unassigned fallback + Status placeholder grid still render.
    expect(json).toContain("_unassigned_");
    // No priority/state → Linear purple.
    expect(accent).toBe("#5E6AD2");
  });

  it("appends a divider + trimmed description when present", () => {
    const long = "x".repeat(700);
    const { blocks } = renderSlackMessage(
      renderToIR(
        <IssueCard identifier="CPK-300" title="Big" description={long} />,
      ),
    );
    expect(blocks.filter((b) => b.type === "divider")).toHaveLength(1);
    const descSection = blocks[blocks.length - 1] as {
      text?: { text: string };
    };
    // Description is trimmed to 600 chars + an ellipsis.
    expect(descSection.text?.text).toBe(`${"x".repeat(600)}…`);
  });
});

describe("PageList component", () => {
  it("renders linked titles, snippets and a count footer", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <PageList
          heading="Runbooks"
          pages={[
            {
              title: "Auth outage runbook",
              url: "https://www.notion.so/abc",
              snippet: "Steps to mitigate auth provider downtime.",
              edited: "3d ago",
            },
            { title: "No-link page" },
          ]}
        />,
      ),
    );
    const json = JSON.stringify(blocks);
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "📚  Runbooks" },
    });
    expect(json).toContain("<https://www.notion.so/abc|*Auth outage runbook*>");
    expect(json).toContain("Steps to mitigate auth provider downtime.");
    expect(json).toContain("🕒 edited 3d ago");
    // A page without a url renders as bold text rather than a link.
    expect(json).toContain("*No-link page*");
    expect(json).not.toContain("|*No-link page*>");
    expect(json).toContain("2 pages");
    // Exactly one divider between the two pages.
    expect(blocks.filter((b) => b.type === "divider")).toHaveLength(1);
    // Notion-dark accent.
    expect(accent).toBe("#2F3437");
  });
});

// ── Telegram parity tests ────────────────────────────────────────────────────
// These tests render the same IR through renderTelegram and assert that the
// unicode status/priority glyphs appear correctly (no Slack `:shortcode:`
// strings that Telegram would not expand).

describe("IssueCard Telegram parity", () => {
  it("renders unicode status and priority glyphs in Telegram output", () => {
    const payload = renderTelegram(
      renderToIR(
        <IssueCard
          identifier="CPK-101"
          title="Checkout 500s under load"
          url="https://linear.app/copilotkit/issue/CPK-101"
          state="In Progress"
          assignee="Alem"
          priority="Urgent"
          team="CPK"
        />,
      ),
    );
    // renderTelegram returns a TelegramPayload with a `text` field (HTML string)
    // and `parseMode: "HTML"` — confirmed from telegram.test.ts line:
    //   expect(out.parseMode).toBe("HTML");
    //   expect(out.text).toContain("<b>Status</b>");
    expect(typeof payload.text).toBe("string");
    // In-progress maps to the blue dot unicode glyph.
    expect(payload.text).toContain("🔵");
    // Urgent priority maps to the siren glyph.
    expect(payload.text).toContain("🚨");
    // Identifier and title text must appear in the output.
    expect(payload.text).toContain("CPK-101");
    expect(payload.text).toContain("Checkout 500s under load");
    // No Slack mrkdwn shortcodes must appear.
    expect(payload.text).not.toContain(":large_blue_circle:");
    expect(payload.text).not.toContain(":rotating_light:");
  });

  it("renders 'done' unicode glyph for justCreated issue in Telegram output", () => {
    const payload = renderTelegram(
      renderToIR(
        <IssueCard identifier="CPK-200" title="New bug" justCreated />,
      ),
    );
    expect(typeof payload.text).toBe("string");
    // justCreated uses the check-mark glyph.
    expect(payload.text).toContain("✅");
    expect(payload.text).toContain("CPK-200");
    expect(payload.text).toContain("New bug");
  });
});

describe("IssueList Telegram parity", () => {
  it("renders unicode status glyphs for each issue in Telegram output", () => {
    const payload = renderTelegram(
      renderToIR(
        <IssueList
          heading="Open"
          issues={[
            {
              identifier: "CPK-101",
              title: "Checkout 500s under load",
              url: "https://linear.app/copilotkit/issue/CPK-101",
              state: "In Progress",
              assignee: "Alem",
              priority: "Urgent",
              updated: "2d ago",
            },
            {
              identifier: "CPK-102",
              title: "Login redirect loop",
              url: "https://linear.app/copilotkit/issue/CPK-102",
              state: "Todo",
              assignee: "Sam",
              priority: "High",
              updated: "5h ago",
            },
          ]}
        />,
      ),
    );
    expect(typeof payload.text).toBe("string");
    // In-progress maps to the blue dot.
    expect(payload.text).toContain("🔵");
    // Todo/unknown maps to the orange dot.
    expect(payload.text).toContain("🟠");
    // Identifiers must be present.
    expect(payload.text).toContain("CPK-101");
    expect(payload.text).toContain("CPK-102");
    // No Slack mrkdwn shortcodes.
    expect(payload.text).not.toContain(":large_blue_circle:");
    expect(payload.text).not.toContain(":large_orange_circle:");
  });
});

describe("PageList Telegram parity", () => {
  it("renders page titles and snippets in Telegram output", () => {
    const payload = renderTelegram(
      renderToIR(
        <PageList
          heading="Runbooks"
          pages={[
            {
              title: "Auth outage runbook",
              url: "https://www.notion.so/abc",
              snippet: "Steps to mitigate auth provider downtime.",
              edited: "3d ago",
            },
          ]}
        />,
      ),
    );
    expect(typeof payload.text).toBe("string");
    expect(payload.text).toContain("Auth outage runbook");
    expect(payload.text).toContain("Steps to mitigate auth provider downtime.");
  });
});
