/** @jsxImportSource @copilotkit/channels-ui */
import { expect, test } from "vitest";
import { createNativeNode, renderToIR } from "@copilotkit/channels-ui";
import type { ClickHandler } from "@copilotkit/channels-ui";
import { Discord } from "./native.js";
import { renderDiscordMessage } from "./render/components-v2.js";

test("Discord native JSX serializes to Components V2 JSON with bound actions", () => {
  const ir = renderToIR(
    <Discord.Message.Container accent_color={0x5865f2}>
      <Discord.Message.TextDisplay content="Deploy ready" />
      <Discord.Message.ActionRow>
        <Discord.Message.Button
          label="Approve"
          style={1}
          value="approve"
          onClick={{ id: "ck:approve" } as unknown as ClickHandler}
        />
      </Discord.Message.ActionRow>
    </Discord.Message.Container>,
  );

  expect(renderDiscordMessage(ir)).toEqual({
    flags: 32768,
    components: [
      {
        type: 17,
        accent_color: 0x5865f2,
        components: [
          { type: 10, content: "Deploy ready" },
          {
            type: 1,
            components: [
              {
                type: 2,
                label: "Approve",
                style: 1,
                custom_id: "ck:approve",
              },
            ],
          },
        ],
      },
    ],
  });
});

test("Discord message delivery rejects another provider's native JSX", () => {
  const slack = createNativeNode("slack", "block", "section", {
    text: "Wrong provider",
  });

  expect(() => renderDiscordMessage([slack])).toThrow(
    /Discord delivery cannot render Slack native JSX/,
  );
});

test("Discord native message validation reports an invalid child path", () => {
  const ir = renderToIR(
    <Discord.Message.Container>
      <Discord.Message.Button
        label="Wrong level"
        style={1}
        onClick={{ id: "ck:wrong" } as unknown as ClickHandler}
      />
    </Discord.Message.Container>,
  );

  expect(() => renderDiscordMessage(ir)).toThrow(
    /Discord\.Message\[0\]\.Container\.components\[0\].*Button.*not allowed/,
  );
});

test("Discord native message validation enforces action-row and tree limits", () => {
  const buttons = Array.from({ length: 6 }, (_, index) => (
    <Discord.Message.Button
      key={index}
      label={`Button ${index}`}
      style={2}
      onClick={{ id: `ck:${index}` } as unknown as ClickHandler}
    />
  ));
  const tooManyButtons = renderToIR(
    <Discord.Message.ActionRow>{buttons}</Discord.Message.ActionRow>,
  );
  expect(() => renderDiscordMessage(tooManyButtons)).toThrow(
    /Discord\.Message\[0\]\.ActionRow.*at most 5 buttons/,
  );

  const tooManyComponents = renderToIR(
    <Discord.Message.Container>
      {Array.from({ length: 40 }, (_, index) => (
        <Discord.Message.TextDisplay key={index} content={`Line ${index}`} />
      ))}
    </Discord.Message.Container>,
  );
  expect(() => renderDiscordMessage(tooManyComponents)).toThrow(
    /Discord message component tree.*40 components/,
  );
});

test("Discord native message rendering covers every stable component type", () => {
  const handler = (id: string) => ({ id }) as unknown as ClickHandler;
  const ir = renderToIR(
    <>
      <Discord.Message.ActionRow>
        <Discord.Message.Button
          label="Approve"
          style={1}
          onClick={handler("ck:button")}
        />
      </Discord.Message.ActionRow>
      <Discord.Message.ActionRow>
        <Discord.Message.StringSelect onSelect={handler("ck:string-select")}>
          <Discord.Object.SelectOption label="Core" value="core" />
        </Discord.Message.StringSelect>
      </Discord.Message.ActionRow>
      <Discord.Message.ActionRow>
        <Discord.Message.UserSelect onSelect={handler("ck:user-select")} />
      </Discord.Message.ActionRow>
      <Discord.Message.ActionRow>
        <Discord.Message.RoleSelect onSelect={handler("ck:role-select")} />
      </Discord.Message.ActionRow>
      <Discord.Message.ActionRow>
        <Discord.Message.MentionableSelect
          onSelect={handler("ck:mentionable-select")}
        />
      </Discord.Message.ActionRow>
      <Discord.Message.ActionRow>
        <Discord.Message.ChannelSelect
          onSelect={handler("ck:channel-select")}
        />
      </Discord.Message.ActionRow>
      <Discord.Message.Section
        accessory={
          <Discord.Message.Thumbnail
            media={
              <Discord.Object.UnfurledMediaItem url="https://example.com/thumb.png" />
            }
          />
        }
      >
        <Discord.Message.TextDisplay content="Status" />
      </Discord.Message.Section>
      <Discord.Message.MediaGallery>
        <Discord.Object.MediaItem
          media={
            <Discord.Object.UnfurledMediaItem url="https://example.com/chart.png" />
          }
          description="Chart"
        />
      </Discord.Message.MediaGallery>
      <Discord.Message.File
        file={
          <Discord.Object.UnfurledMediaItem url="attachment://report.pdf" />
        }
      />
      <Discord.Message.Separator divider spacing={1} />
      <Discord.Message.Container>
        <Discord.Message.TextDisplay content="Done" />
      </Discord.Message.Container>
    </>,
  );

  const { components } = renderDiscordMessage(ir);
  const types = new Set<number>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (typeof record.type === "number") types.add(record.type);
    Object.values(record).forEach(visit);
  };
  visit(components);

  expect([...types].sort((left, right) => left - right)).toEqual([
    1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17,
  ]);
});
