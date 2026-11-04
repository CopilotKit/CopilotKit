import { Component, viewChild } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { StickToBottom } from "../stick-to-bottom";
import { ScrollPosition } from "../../scroll-position";

@Component({
  imports: [StickToBottom],
  template: `
    <div copilotStickToBottom [enabled]="false"></div>
  `,
})
class Host {
  readonly stick = viewChild.required(StickToBottom);
}

/** jsdom has no layout: give the element the sizes a browser would report. */
function scrolledElement(distanceFromEnd: number) {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    scrollHeight: { value: 1000 },
    clientHeight: { value: 500 },
    scrollTop: { value: 500 - distanceFromEnd },
  });
  return element;
}

describe("scroll-to-bottom threshold", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("counts 12px or less from the end as the bottom by default", () => {
    const scroll = TestBed.inject(ScrollPosition);
    expect(scroll.isAtBottom(scrolledElement(12))).toBe(true);
    expect(scroll.isAtBottom(scrolledElement(13))).toBe(false);
  });

  it("gives the directive the same 12px default", () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(fixture.componentInstance.stick().threshold()).toBe(12);
  });
});
