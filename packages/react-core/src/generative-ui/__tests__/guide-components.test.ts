import { describe, expect, it } from "vitest";
import {
  defaultGenerativeUIPromptSpec,
  GUIDE_COMPONENTS,
} from "@copilotkit/shared";
import { standardUI } from "../standard";

describe("GUIDE_COMPONENTS", () => {
  it("lists exactly the standard components that the markdown guide names", () => {
    const { whenToShow, rules } = defaultGenerativeUIPromptSpec().markdown;
    const text = [
      whenToShow,
      ...rules.flatMap((rule) =>
        typeof rule === "string" ? [rule] : rule.items,
      ),
    ].join("\n");
    const named = [...standardUI.components.keys()].filter((name) =>
      new RegExp(`\\b${name}s?\\b`).test(text),
    );
    expect([...GUIDE_COMPONENTS].sort()).toEqual(named.sort());
  });
});
