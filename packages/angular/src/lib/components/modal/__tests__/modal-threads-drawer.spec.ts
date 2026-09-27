import { Component, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  COPILOT_CHAT_CONFIGURATION,
  CopilotChatConfiguration,
  provideCopilotChatConfiguration,
} from "../../../chat-configuration";
import { provideCopilotKit } from "../../../config";
import { CopilotPopup } from "../copilot-popup";
import { CopilotSidebar } from "../copilot-sidebar";

@Component({
  selector: "test-chat",
  template: "Chat",
  standalone: true,
})
class TestChat {
  // The chat reads its thread from the same configuration as the drawer.
  readonly config = inject(COPILOT_CHAT_CONFIGURATION);
  static latest?: TestChat;
  constructor() {
    TestChat.latest = this;
  }
}

describe("modal threads drawer", () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render(
    component: typeof CopilotPopup | typeof CopilotSidebar,
    threadsDrawer: boolean,
  ) {
    await TestBed.configureTestingModule({
      imports: [component],
      providers: [provideCopilotKit({ enableInspector: false })],
    }).compileComponents();
    const fixture = TestBed.createComponent(component);
    fixture.componentRef.setInput("chatComponent", TestChat);
    fixture.componentRef.setInput("threadsDrawer", threadsDrawer);
    if (component === CopilotSidebar) {
      fixture.componentRef.setInput("mode", "overlay");
    }
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      launcher: () =>
        element.querySelector<HTMLButtonElement>(
          '[data-testid="copilot-threads-drawer-launcher"]',
        ),
      drawer: () =>
        element.querySelector("copilotkit-threads-drawer") as
          | (HTMLElement & { open: boolean })
          | null,
    };
  }

  it.each([
    ["popup", CopilotPopup],
    ["sidebar", CopilotSidebar],
  ])(
    "renders no launcher or drawer by default in the %s",
    async (_, component) => {
      const { launcher, drawer } = await render(component, false);
      expect(launcher()).toBeNull();
      expect(drawer()).toBeNull();
    },
  );

  it.each([
    ["popup", CopilotPopup],
    ["sidebar", CopilotSidebar],
  ])(
    "opens an overlay drawer from the header launcher in the %s",
    async (_, component) => {
      const { fixture, launcher, drawer } = await render(component, true);
      expect(launcher()).not.toBeNull();
      expect(drawer()?.hasAttribute("overlay")).toBe(true);
      expect(drawer()?.open).toBe(false);
      expect(launcher()?.getAttribute("aria-expanded")).toBe("false");

      launcher()!.click();
      fixture.detectChanges();
      expect(drawer()?.open).toBe(true);
      expect(launcher()?.getAttribute("aria-expanded")).toBe("true");

      // The element reports its own close (Escape, scrim, thread pick).
      drawer()!.dispatchEvent(
        new CustomEvent("open-change", { detail: { open: false } }),
      );
      fixture.detectChanges();
      expect(drawer()?.open).toBe(false);
    },
  );

  it("closes the drawer when the popup closes", async () => {
    const { fixture, launcher, drawer } = await render(CopilotPopup, true);
    launcher()!.click();
    fixture.detectChanges();
    expect(drawer()?.open).toBe(true);

    fixture.componentRef.setInput("open", false);
    fixture.detectChanges();
    fixture.componentRef.setInput("open", true);
    fixture.detectChanges();
    expect(drawer()?.open).toBe(false);
  });

  it.each([
    ["popup", CopilotPopup],
    ["sidebar", CopilotSidebar],
  ])(
    "switches the chat's thread from the %s drawer without an app-level chat configuration",
    async (_, component) => {
      const { drawer } = await render(component, true);
      const config = TestChat.latest!.config;
      expect(config.hasExplicitThreadId()).toBe(false);

      drawer()!.dispatchEvent(
        new CustomEvent("thread-selected", {
          detail: { threadId: "thread-42" },
        }),
      );

      expect(config.threadId()).toBe("thread-42");
      expect(config.hasExplicitThreadId()).toBe(true);
    },
  );

  it("uses the app's chat configuration when one is in scope", async () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotChatConfiguration({ agentId: "support" })],
    });
    const { drawer } = await render(CopilotPopup, true);
    const appConfig = TestBed.inject(CopilotChatConfiguration);
    expect(TestChat.latest!.config).toBe(appConfig);

    drawer()!.dispatchEvent(
      new CustomEvent("thread-selected", { detail: { threadId: "thread-7" } }),
    );
    expect(appConfig.threadId()).toBe("thread-7");
  });
});
