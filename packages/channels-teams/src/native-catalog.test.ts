import { expect, test } from "vitest";
import { createNativeNode } from "@copilotkit/channels-ui";
import { renderTeamsNativeCard } from "./native-codec.js";
import {
  TEAMS_ACTION_MANIFEST,
  TEAMS_BODY_MANIFEST,
  TEAMS_NATIVE_MANIFEST,
  TEAMS_PREVIEW_MANIFEST,
} from "./native-manifest.js";

test("Teams keeps the audited stable and preview catalog counts", () => {
  expect(TEAMS_BODY_MANIFEST).toHaveLength(38);
  expect(TEAMS_ACTION_MANIFEST).toHaveLength(7);
  expect(TEAMS_PREVIEW_MANIFEST.map(([name]) => name)).toEqual([
    "Accordion",
    "LoopComponent",
    "TabSet",
    "RunCommands",
  ]);
});

test("every Teams catalog entry serializes with its native discriminator", () => {
  for (const entry of TEAMS_NATIVE_MANIFEST) {
    expect(entry.source).toBe("https://adaptivecards.microsoft.com/");
    if (entry.kind === "root") continue;
    const child = createNativeNode("teams", entry.kind, entry.component, {});
    if (entry.kind === "layout") {
      expect(child.props.nativeType).toBe(entry.component);
      continue;
    }
    const root = createNativeNode("teams", "root", "AdaptiveCard", {
      children: [child],
    });
    const card = renderTeamsNativeCard([root]);
    const serialized =
      entry.kind === "action" || entry.component === "RunCommands"
        ? card.actions?.[0]
        : card.body[0];
    expect(serialized?.type).toBe(entry.type);
    expect(serialized).toMatchObject(entry.fixedProps);
  }
});
