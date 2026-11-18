import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ɵcopilotIcons } from "@copilotkit/core";
import type { CopilotIconName } from "@copilotkit/core";
import { describe, expect, it } from "vitest";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  CopilotIcon,
  Edit,
  EyeOff,
  Loader2,
  MessageCircle,
  Mic,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Square,
  ThumbsDown,
  ThumbsUp,
  Upload,
  Volume2,
  Wrench,
  X,
} from "../copilot-icon";
import type { CopilotIconData } from "../copilot-icon";

function renderIcon(
  img: CopilotIconData,
  options: { size?: number; iconClass?: string } = {},
) {
  TestBed.configureTestingModule({
    imports: [CopilotIcon],
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(CopilotIcon);
  fixture.componentRef.setInput("img", img);
  if (options.size !== undefined) {
    fixture.componentRef.setInput("size", options.size);
  }
  if (options.iconClass !== undefined) {
    fixture.componentRef.setInput("iconClass", options.iconClass);
  }
  fixture.detectChanges();
  const host: HTMLElement = fixture.nativeElement;
  const svg = host.querySelector("svg");
  if (!svg) throw new Error("copilot-icon rendered no <svg>");
  return { host, svg };
}

describe("CopilotIcon", () => {
  it("renders a path icon at the requested size, hidden from assistive tech", () => {
    const { host, svg } = renderIcon(Check, { size: 18 });

    expect(svg.getAttribute("width")).toBe("18");
    expect(svg.getAttribute("height")).toBe("18");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke-width")).toBe("2");
    expect(host.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(
      "M20 6 9 17l-5-5",
    );
  });

  it("renders rect attributes", () => {
    const { svg } = renderIcon(Copy);

    const rect = svg.querySelector("rect");
    expect(rect?.getAttribute("width")).toBe("14");
    expect(rect?.getAttribute("x")).toBe("8");
    expect(rect?.getAttribute("rx")).toBe("2");
    expect(rect?.getAttribute("ry")).toBe("2");
  });

  it("renders circle nodes", () => {
    const { svg } = renderIcon(Circle);

    const circle = svg.querySelector("circle");
    expect(circle?.getAttribute("cx")).toBe("12");
    expect(circle?.getAttribute("cy")).toBe("12");
    expect(circle?.getAttribute("r")).toBe("10");
  });

  it("renders polygon nodes", () => {
    const { svg } = renderIcon(Play);

    expect(svg.querySelector("polygon")?.getAttribute("points")).toBe(
      "6 3 20 12 6 21 6 3",
    );
  });

  it("puts the Lucide classes and iconClass on the svg", () => {
    const { svg } = renderIcon(Check, {
      iconClass: "cpk-chat-input-send-icon",
    });

    expect(svg.getAttribute("class")).toBe(
      "lucide lucide-check cpk-chat-input-send-icon",
    );
  });

  it("adds no Lucide class to icon data that is not from core", () => {
    const { svg } = renderIcon([{ tag: "path", attributes: { d: "M0 0h1" } }]);

    expect(svg.hasAttribute("class")).toBe(false);
  });

  const exportedIcons: ReadonlyArray<
    [CopilotIconName, CopilotIconData, string]
  > = [
    ["ArrowUp", ArrowUp, "arrow-up"],
    ["Check", Check, "check"],
    ["ChevronDown", ChevronDown, "chevron-down"],
    ["ChevronLeft", ChevronLeft, "chevron-left"],
    ["ChevronRight", ChevronRight, "chevron-right"],
    ["Circle", Circle, "circle"],
    ["Copy", Copy, "copy"],
    ["Edit", Edit, "square-pen"],
    ["EyeOff", EyeOff, "eye-off"],
    ["Loader2", Loader2, "loader-circle"],
    ["MessageCircle", MessageCircle, "message-circle"],
    ["Mic", Mic, "mic"],
    ["PanelLeftOpen", PanelLeftOpen, "panel-left-open"],
    ["Play", Play, "play"],
    ["Plus", Plus, "plus"],
    ["RefreshCw", RefreshCw, "refresh-cw"],
    ["Square", Square, "square"],
    ["ThumbsDown", ThumbsDown, "thumbs-down"],
    ["ThumbsUp", ThumbsUp, "thumbs-up"],
    ["Upload", Upload, "upload"],
    ["Volume2", Volume2, "volume-2"],
    ["Wrench", Wrench, "wrench"],
    ["X", X, "x"],
  ];

  it.each(exportedIcons)(
    "exports %s as core's data and draws its Lucide class",
    (coreName, img, lucideName) => {
      expect(img).toBe(ɵcopilotIcons[coreName].nodes);

      const { svg } = renderIcon(img);
      expect(svg.getAttribute("class")).toBe(`lucide lucide-${lucideName}`);
    },
  );

  it("exports every icon that core has", () => {
    const exportedNames = exportedIcons.map(([coreName]) => coreName).sort();

    expect(exportedNames).toEqual(Object.keys(ɵcopilotIcons).sort());
  });
});
