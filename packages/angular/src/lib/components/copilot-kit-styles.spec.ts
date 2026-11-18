import { CSP_NONCE, Component, Injectable, signal } from "@angular/core";
import type { Provider } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatState } from "../chat-state";
import { provideCopilotKit } from "../config";
import { CopilotChatView } from "./chat/copilot-chat-view";
import { CopilotKitStyles } from "./copilot-kit-styles";
import { CopilotPopup } from "./modal/copilot-popup";
import { CopilotSidebar } from "./modal/copilot-sidebar";
import { stylesheet } from "./stylesheet";

@Injectable()
class ChatStateStub extends ChatState {
  readonly inputValue = signal("");

  submitInput(value: string): void {
    this.inputValue.set(value);
  }

  changeInput(value: string): void {
    this.inputValue.set(value);
  }
}

@Component({
  imports: [CopilotKitStyles, CopilotChatView],
  template: `
    <copilot-kit-styles />
    <copilot-kit-styles />
    <copilot-chat-view [messages]="[]" />
  `,
})
class TwoStylesAndAChatHost {}

@Component({
  imports: [CopilotChatView],
  template: `
    <copilot-chat-view [messages]="[]" />
  `,
})
class ChatOnlyHost {}

@Component({
  imports: [CopilotPopup, CopilotSidebar],
  template: `
    <copilot-popup [open]="false" />
    <copilot-sidebar [open]="false" />
  `,
})
class ClosedLaunchersHost {}

/** The `<style>` tags in `<head>` that hold the shared stylesheet. */
function stylesheetTags(): HTMLStyleElement[] {
  return Array.from(document.head.querySelectorAll("style")).filter(
    (style) => style.textContent === stylesheet,
  );
}

function setup(
  config: Parameters<typeof provideCopilotKit>[0],
  extra: Provider[] = [],
) {
  TestBed.configureTestingModule({
    providers: [
      provideCopilotKit({
        licenseKey: "ck_pub_00000000000000000000000000000000",
        ...config,
      }),
      { provide: ChatState, useClass: ChatStateStub },
      ...extra,
    ],
  });
}

describe("CopilotKitStyles", () => {
  // Angular adopts <style> tags already in <head> (that is how it reuses the
  // server-rendered ones), so a tag another spec left behind would count here.
  beforeEach(() => {
    for (const style of stylesheetTags()) style.remove();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("is the CSS that @copilotkit/core ships", async () => {
    const core = await import("@copilotkit/core/styles");
    expect(stylesheet).toBe(core.stylesheet);
    expect(stylesheet).toContain(".cpk-chat-view");
  });

  it("adds the stylesheet to <head> when the chat view renders", () => {
    setup({});
    const fixture = TestBed.createComponent(ChatOnlyHost);
    fixture.detectChanges();

    expect(stylesheetTags()).toHaveLength(1);
  });

  it("adds the stylesheet for a closed popup and sidebar, whose toggles need it", () => {
    setup({});
    const fixture = TestBed.createComponent(ClosedLaunchersHost);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(".cpk-chat-view"),
    ).toBeNull();
    expect(stylesheetTags()).toHaveLength(1);
  });

  it("adds one copy however many components render it", () => {
    setup({});
    const fixture = TestBed.createComponent(TwoStylesAndAChatHost);
    fixture.detectChanges();

    expect(stylesheetTags()).toHaveLength(1);
  });

  it("adds nothing with injectStyles: false", () => {
    setup({ injectStyles: false });
    const fixture = TestBed.createComponent(TwoStylesAndAChatHost);
    fixture.detectChanges();

    expect(stylesheetTags()).toHaveLength(0);
    // The chat itself still renders.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(".cpk-chat-view"),
    ).not.toBeNull();
  });

  it("gives the <style> tag the CSP_NONCE nonce", () => {
    setup({}, [{ provide: CSP_NONCE, useValue: "test-nonce" }]);
    const fixture = TestBed.createComponent(ChatOnlyHost);
    fixture.detectChanges();

    const [style] = stylesheetTags();
    expect(style?.getAttribute("nonce")).toBe("test-nonce");
  });
});
