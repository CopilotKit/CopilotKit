import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Check, CopilotIcon, Copy } from "./copilot-icon";

test("renders path-based icon data at the requested size", () => {
  TestBed.configureTestingModule({
    imports: [CopilotIcon],
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(CopilotIcon);
  fixture.componentRef.setInput("img", Check);
  fixture.componentRef.setInput("size", 18);
  fixture.detectChanges();

  const svg = fixture.nativeElement.querySelector("svg") as SVGElement;
  expect(svg.getAttribute("width")).toBe("18");
  expect(svg.getAttribute("height")).toBe("18");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.querySelector("path")?.getAttribute("d")).toBe("M20 6 9 17l-5-5");
});

test("renders rectangle attributes without unsafe HTML injection", () => {
  TestBed.configureTestingModule({
    imports: [CopilotIcon],
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(CopilotIcon);
  fixture.componentRef.setInput("img", Copy);
  fixture.detectChanges();

  const rect = fixture.nativeElement.querySelector("rect") as SVGRectElement;
  expect(rect.getAttribute("width")).toBe("14");
  expect(rect.getAttribute("rx")).toBe("2");
});
