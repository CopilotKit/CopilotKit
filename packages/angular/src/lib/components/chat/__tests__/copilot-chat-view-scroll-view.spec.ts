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

describe("CopilotChatViewScrollView with auto-scroll", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("hides the scroll-to-bottom button again when auto-scroll is turned off and on", async () => {
    await TestBed.configureTestingModule({
      imports: [CopilotChatViewScrollView],
      providers: [provideCopilotKit({})],
    }).compileComponents();
    const fixture = TestBed.createComponent(CopilotChatViewScrollView);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const viewport = () =>
      host.querySelector<HTMLElement>(".cpk-chat-view-scroll-viewport")!;
    const button = () => host.querySelector(".cpk-chat-view-scroll-to-bottom");

    setScroll(viewport(), 300); // the reader scrolls up
    fixture.detectChanges();
    expect(button()).not.toBeNull();

    fixture.componentRef.setInput("autoScroll", false);
    fixture.detectChanges();
    fixture.componentRef.setInput("autoScroll", true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(button()).toBeNull();
  });
});
