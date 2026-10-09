import { ViewEncapsulation } from "@angular/core";
import { describe, expect, it } from "vitest";
import * as publicApi from "../../public-api";

// Angular does not rewrite `:host` for ViewEncapsulation.None components, and it
// copies their styles into every shadow root in the app. A `:host` rule there
// restyles unrelated ViewEncapsulation.ShadowDom hosts (#7434). Use host
// classes instead.
describe("ViewEncapsulation.None component styles", () => {
  const unencapsulated = Object.entries(publicApi).filter(
    ([, value]) =>
      typeof value === "function" &&
      (value as { ɵcmp?: { encapsulation: ViewEncapsulation } }).ɵcmp
        ?.encapsulation === ViewEncapsulation.None,
  ) as [string, { ɵcmp: { styles: string[] } }][];

  it("finds the unencapsulated chat components", () => {
    const names = unencapsulated.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        "CopilotChatInput",
        "CopilotChatAssistantMessage",
        "CopilotChatUserMessage",
      ]),
    );
  });

  it.each(unencapsulated.map(([name, cmp]) => [name, cmp] as const))(
    "%s has no :host selector",
    (_name, cmp) => {
      expect(cmp.ɵcmp.styles.join("\n")).not.toMatch(/:host\b/);
    },
  );
});
