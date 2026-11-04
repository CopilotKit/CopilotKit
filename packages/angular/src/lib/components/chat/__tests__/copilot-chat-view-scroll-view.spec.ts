import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { provideCopilotKit } from "../../../config";
import { CopilotChatViewScrollView } from "../copilot-chat-view-scroll-view";

/** jsdom has no layout: give the scroll container the sizes a browser would. */
function setScroll(element: HTMLElement, distanceFromEnd: number) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 500 },
    scrollTop: { configurable: true, value: 500 - distanceFromEnd },
  });
  element.dispatchEvent(new Event("scroll"));
}

async function renderManualScrollView() {
  await TestBed.configureTestingModule({
    imports: [CopilotChatViewScrollView],
    providers: [provideCopilotKit({})],
  }).compileComponents();
  const fixture = TestBed.createComponent(CopilotChatViewScrollView);
  fixture.componentRef.setInput("autoScroll", false);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const scroll = host.querySelector<HTMLElement>(
    ".cpk-chat-view-scroll-viewport",
  )!;
  const button = () => host.querySelector(".cpk-chat-view-scroll-to-bottom");
  return { fixture, scroll, button };
}

describe("CopilotChatViewScrollView without auto-scroll", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("shows the scroll-to-bottom button only beyond core's 12px threshold", async () => {
    const { fixture, scroll, button } = await renderManualScrollView();

    setScroll(scroll, 12);
    fixture.detectChanges();
    expect(button()).toBeNull();

    setScroll(scroll, 13);
    fixture.detectChanges();
    expect(button()).not.toBeNull();
  });
});
