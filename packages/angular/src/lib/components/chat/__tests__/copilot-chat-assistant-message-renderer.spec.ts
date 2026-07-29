import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { CopilotChatAssistantMessageRenderer } from "../copilot-chat-assistant-message-renderer";

describe("CopilotChatAssistantMessageRenderer math parsing", () => {
  function render(content: string): string {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(
      CopilotChatAssistantMessageRenderer,
    );
    fixture.componentRef.setInput("content", content);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector("div").innerHTML;
  }

  it("preserves currency ranges as prose", () => {
    const rendered = render(
      "United at $349 (departing 08:00) and Delta at $289, both on time.",
    );

    expect(rendered).toContain("$349");
    expect(rendered).toContain("$289");
    expect(rendered).not.toContain('class="katex"');
  });

  it("renders inline math with non-whitespace delimiters", () => {
    const rendered = render("Euler's identity is $e^{i\\pi} + 1 = 0$.");

    expect(rendered).toContain('class="katex"');
    expect(rendered).not.toContain("$e^{i\\pi} + 1 = 0$");
  });

  it("leaves dollar signs in inline code untouched", () => {
    const rendered = render("Run `echo $PATH`.");

    expect(rendered).toContain("<code>echo $PATH</code>");
    expect(rendered).not.toContain('class="katex"');
  });
});
