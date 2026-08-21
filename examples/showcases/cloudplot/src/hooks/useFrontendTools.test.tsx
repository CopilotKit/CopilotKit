import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "useFrontendTools.tsx"), "utf8");

describe("useFrontendTools contract", () => {
  it("registers generative UI for add, connect, remove, and VPC move cards", () => {
    for (const toolName of [
      "add_resource",
      "connect_resources",
      "remove_resource",
      "move_to_vpc",
    ]) {
      expect(source).toContain(`name: "${toolName}"`);
    }
    for (const cardName of [
      "ResourceCard",
      "ConnectionCard",
      "RemoveCard",
      "MoveCard",
    ]) {
      expect(source).toContain(cardName);
    }
  });

  it("passes tool status into every rendered card", () => {
    expect(source.match(/status={status}/g)).toHaveLength(4);
  });
});
