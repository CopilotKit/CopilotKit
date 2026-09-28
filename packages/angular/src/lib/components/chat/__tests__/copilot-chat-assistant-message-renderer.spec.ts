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

describe("CopilotChatAssistantMessageRenderer URL safety", () => {
  function render(content: string): HTMLElement {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(
      CopilotChatAssistantMessageRenderer,
    );
    fixture.componentRef.setInput("content", content);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const hrefs = (element: HTMLElement) =>
    Array.from(element.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );

  it("keeps app schemes, ftp, sms and blob links", () => {
    const element = render(
      "[a](myapp://open/42) [b](ftp://files.example.com) [c](sms:+15551234) [d](blob:https://x.y/1) [e](mailto:a@b.c) [f](/docs)",
    );
    expect(hrefs(element)).toEqual([
      "myapp://open/42",
      "ftp://files.example.com",
      "sms:+15551234",
      "blob:https://x.y/1",
      "mailto:a@b.c",
      "/docs",
    ]);
  });

  it("blocks javascript:, vbscript: and non-image data: links, however encoded", () => {
    const element = render(
      "[a](javascript:alert(1)) [b](VBScript:msgbox) [c](data:text/html,x) [d](java&#x09;script:alert(1))",
    );
    expect(hrefs(element)).toEqual(["#", "#", "#", "#"]);
  });

  it("renders links with out-of-range character references", () => {
    const element = render("[a](&#x110000;x) after");
    expect(element.querySelector("a")?.textContent).toBe("a");
    expect(element.textContent).toContain("after");
  });

  it("allows data: images but not scripts as image sources", () => {
    const element = render(
      "![ok](data:image/png;base64,AAAA) ![bad](javascript:alert(1))",
    );
    const sources = Array.from(element.querySelectorAll("img")).map((img) =>
      img.getAttribute("src"),
    );
    expect(sources).toEqual(["data:image/png;base64,AAAA", ""]);
  });
});
