// packages/channels-discord/src/__tests__/modal-submit.test.ts
import { ComponentType } from "discord.js";
import { it, expect, vi } from "vitest";
import { decodeModalSubmit } from "../interaction.js";

it("decodes a modal submission's text fields by custom_id", async () => {
  const interaction = {
    customId: "triage",
    channelId: "C1",
    guildId: "G1",
    user: { id: "U1", username: "ada" },
    fields: {
      fields: new Map([
        ["summary", { customId: "summary", value: "boom" }],
        ["detail", { customId: "detail", value: "ctx" }],
      ]),
    },
  };
  const evt = await decodeModalSubmit(interaction);
  expect(evt).toMatchObject({
    callbackId: "triage",
    values: { summary: "boom", detail: "ctx" },
    actor: { id: "U1", kind: "human", name: "ada" },
    identityContext: {
      tenant: { id: "G1" },
      conversation: { id: "C1", kind: "guild" },
      trigger: "modal_submit",
    },
    conversationKey: "C1",
    replyTarget: { channelId: "C1", guildId: "G1" },
    platform: "discord",
  });
});

it("normalizes every stable modal value type and hydrates uploaded files", async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response("incident details", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
  );
  const fields = new Map<string, Record<string, unknown>>([
    [
      "text",
      { type: ComponentType.TextInput, customId: "text", value: "boom" },
    ],
    [
      "string",
      {
        type: ComponentType.StringSelect,
        customId: "string",
        values: ["core", "infra"],
      },
    ],
    [
      "ck-portable-single:service",
      {
        type: ComponentType.StringSelect,
        customId: "ck-portable-single:service",
        values: ["api"],
      },
    ],
    [
      "user",
      {
        type: ComponentType.UserSelect,
        customId: "user",
        values: ["U1"],
      },
    ],
    [
      "role",
      {
        type: ComponentType.RoleSelect,
        customId: "role",
        values: ["R1"],
      },
    ],
    [
      "mentionable",
      {
        type: ComponentType.MentionableSelect,
        customId: "mentionable",
        values: ["U1", "R1"],
      },
    ],
    [
      "channel",
      {
        type: ComponentType.ChannelSelect,
        customId: "channel",
        values: ["C2"],
      },
    ],
    [
      "radio",
      {
        type: ComponentType.RadioGroup,
        customId: "radio",
        value: "fast",
      },
    ],
    [
      "checkboxes",
      {
        type: ComponentType.CheckboxGroup,
        customId: "checkboxes",
        values: ["email", "sms"],
      },
    ],
    [
      "checkbox",
      {
        type: ComponentType.Checkbox,
        customId: "checkbox",
        value: true,
      },
    ],
    [
      "files",
      {
        type: ComponentType.FileUpload,
        customId: "files",
        attachments: new Map([
          [
            "A1",
            {
              name: "incident.txt",
              contentType: "text/plain",
              size: 16,
              url: "https://cdn.discord.test/secret-token",
            },
          ],
        ]),
      },
    ],
  ]);

  const event = await decodeModalSubmit(
    {
      customId: "triage",
      channelId: "C1",
      user: { id: "U1" },
      fields: { fields },
    },
    { fetchImpl },
  );

  expect(event.values).toEqual({
    text: "boom",
    string: ["core", "infra"],
    service: "api",
    user: ["U1"],
    role: ["R1"],
    mentionable: ["U1", "R1"],
    channel: ["C2"],
    radio: "fast",
    checkboxes: ["email", "sms"],
    checkbox: true,
    files: [
      {
        name: "incident.txt",
        mimeType: "text/plain",
        size: 16,
        contentParts: [
          {
            type: "text",
            text: expect.stringContaining("incident details"),
          },
        ],
      },
    ],
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(event.values)).not.toContain("cdn.discord.test");
});
