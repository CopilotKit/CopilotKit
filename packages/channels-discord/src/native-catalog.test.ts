import { expect, test } from "vitest";
import { Discord } from "./native.js";
import {
  DISCORD_MESSAGE_MANIFEST,
  DISCORD_MODAL_MANIFEST,
  DISCORD_OBJECT_MANIFEST,
} from "./native-manifest.js";

test("Discord exposes every reviewed stable message component", () => {
  expect(DISCORD_MESSAGE_MANIFEST.map(([name]) => name)).toEqual([
    "ActionRow",
    "Button",
    "StringSelect",
    "UserSelect",
    "RoleSelect",
    "MentionableSelect",
    "ChannelSelect",
    "Section",
    "TextDisplay",
    "Thumbnail",
    "MediaGallery",
    "File",
    "Separator",
    "Container",
  ]);
  expect(Object.keys(Discord.Message)).toEqual(
    DISCORD_MESSAGE_MANIFEST.map(([name]) => name),
  );
});

test("Discord exposes every reviewed stable modal component", () => {
  expect(DISCORD_MODAL_MANIFEST.map(([name]) => name)).toEqual([
    "TextDisplay",
    "Label",
    "TextInput",
    "StringSelect",
    "UserSelect",
    "RoleSelect",
    "MentionableSelect",
    "ChannelSelect",
    "FileUpload",
    "RadioGroup",
    "CheckboxGroup",
    "Checkbox",
  ]);
  expect(Object.keys(Discord.Modal)).toEqual(
    DISCORD_MODAL_MANIFEST.map(([name]) => name),
  );
});

test("Discord exposes typed objects and a raw escape hatch", () => {
  expect(DISCORD_OBJECT_MANIFEST.map(([name]) => name)).toEqual([
    "SelectOption",
    "MediaItem",
    "UnfurledMediaItem",
    "RadioOption",
    "CheckboxOption",
  ]);
  expect(Object.keys(Discord.Object)).toEqual(
    DISCORD_OBJECT_MANIFEST.map(([name]) => name),
  );
  expect(Discord.Raw({ value: { type: 10, content: "Hello" } })).toMatchObject({
    props: { provider: "discord", nativeKind: "raw" },
  });
});
