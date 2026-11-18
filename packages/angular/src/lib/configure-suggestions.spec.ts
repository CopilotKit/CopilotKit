import { Component, inject, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { provideCopilotChatConfiguration } from "./chat-configuration";
import { provideCopilotKit } from "./config";
import { CopilotKit } from "./copilotkit";

const topic = signal("billing");

@Component({
  standalone: true,
  template: "",
  providers: [provideCopilotChatConfiguration({ agentId: "support" })],
})
class SuggestionsHost {
  readonly copilotKit = inject(CopilotKit);
  readonly suggestions = this.copilotKit.configureSuggestions(() => ({
    suggestions: [{ title: `About ${topic()}`, message: "Tell me more" }],
    available: "always",
  }));
}

function titles(agentId: string) {
  return TestBed.inject(CopilotKit)
    .core.getSuggestions(agentId)
    .suggestions.map((suggestion) => suggestion.title);
}

function render() {
  TestBed.configureTestingModule({
    imports: [SuggestionsHost],
    providers: [provideCopilotKit({})],
  });
  const fixture = TestBed.createComponent(SuggestionsHost);
  fixture.detectChanges();
  return fixture;
}

afterEach(() => {
  TestBed.resetTestingModule();
  topic.set("billing");
});

describe("CopilotKit.configureSuggestions", () => {
  it("loads a global config for the surrounding chat configuration's agent", () => {
    render();

    expect(titles("support")).toEqual(["About billing"]);
  });

  it("re-applies the config when a signal it reads changes", async () => {
    const fixture = render();

    topic.set("refunds");
    fixture.detectChanges();
    await fixture.whenStable();

    expect(titles("support")).toEqual(["About refunds"]);
  });

  it("removes the config when the calling context is destroyed", () => {
    const fixture = render();

    fixture.destroy();
    TestBed.inject(CopilotKit).core.reloadSuggestions("support");

    expect(titles("support")).toEqual([]);
  });

  it("keeps working alongside addSuggestionsConfig", () => {
    const fixture = render();
    const copilotKit = fixture.componentInstance.copilotKit;
    copilotKit.addSuggestionsConfig({
      suggestions: [{ title: "Static", message: "Static" }],
      available: "always",
    });

    fixture.componentInstance.suggestions.reload();

    expect(titles("support")).toEqual(["About billing", "Static"]);
  });
});
