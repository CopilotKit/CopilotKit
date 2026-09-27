import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { CopilotChatUserMessageRenderer } from "../copilot-chat-user-message-renderer";

describe("CopilotChatUserMessageRenderer", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CopilotChatUserMessageRenderer],
    });
  });

  const render = (content: string) => {
    const fixture = TestBed.createComponent(CopilotChatUserMessageRenderer);
    fixture.componentRef.setInput("content", content);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it("renders markdown while keeping headings and pasted HTML literal", () => {
    const element = render(
      "# Not a heading\nUse `map()` on <b>users</b>\n\n- one\n- two",
    );
    expect(element.querySelector("h1")).toBeNull();
    expect(element.textContent).toContain("# Not a heading");
    expect(element.querySelector("code")?.textContent).toBe("map()");
    expect(element.querySelector("b")).toBeNull();
    expect(element.textContent).toContain("<b>users</b>");
    expect(element.querySelectorAll("li")).toHaveLength(2);
    expect(element.className).not.toContain("whitespace-pre-wrap");
  });

  it("renders setext headings as plain paragraphs", () => {
    const element = render("Title\n===");
    expect(element.querySelector("h1, h2")).toBeNull();
  });

  it("neutralizes script links", () => {
    const element = render("[click](javascript:alert(1)) [ok](https://a.b)");
    const links = Array.from(element.querySelectorAll("a"));
    expect(links[0]?.getAttribute("href")).toBe("#");
    expect(links[1]?.getAttribute("href")).toBe("https://a.b");
  });
});
