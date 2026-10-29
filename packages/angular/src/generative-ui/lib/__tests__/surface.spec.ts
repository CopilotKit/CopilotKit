import { Component, input, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import type { GenerativeUI } from "../catalog";
import { GENERATIVE_UI_RUNTIME } from "../runtime";
import { CopilotGenerativeUISurface } from "../surface";
import { createTestRuntime } from "./render";

@Component({
  selector: "test-row",
  template: `
    <p data-row>{{ text() }}</p>
  `,
})
class Row {
  readonly text = input<string>();
}

const ui = createGenerativeUI({
  id: "test/targets@1",
  components: {
    Row: { component: Row, props: z.object({ text: z.string() }) },
    Card: { component: Row, props: z.object({ text: z.string() }) },
  },
});

@Component({
  imports: [CopilotGenerativeUISurface],
  template: `
    <copilot-generative-ui-surface
      id="side"
      description="The side panel"
      [ui]="ui()"
      [components]="components()"
      [autoScroll]="autoScroll()"
    >
      <em data-fallback>Nothing yet</em>
    </copilot-generative-ui-surface>
  `,
})
class Host {
  // Signals: a plain property change does not reach the bindings here.
  readonly ui = signal<GenerativeUI | undefined>(undefined);
  readonly components = signal<string[] | undefined>(undefined);
  readonly autoScroll = signal(true);
}

/** `surfaceUI` is the ui input; left out, the surface gets none. */
function setup(components?: string[], surfaceUI?: GenerativeUI) {
  const { runtime, reportError } = createTestRuntime(ui);
  TestBed.configureTestingModule({
    providers: [{ provide: GENERATIVE_UI_RUNTIME, useValue: runtime }],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.components.set(components);
  fixture.componentInstance.ui.set(surfaceUI);
  fixture.detectChanges();
  /** Streams surface s1 into the target, with `text` in a Row, unless `status` says it is done. */
  const render = (
    text: string,
    status: "streaming" | "ready" = "streaming",
  ) => {
    const content: GenerativeUISurfaceContent = {
      surfaceId: "s1",
      target: "side",
      catalogId: ui.id,
      operations: [
        {
          version: "v1.0",
          createSurface: { surfaceId: "s1", catalogId: ui.id },
        },
        {
          version: "v1.0",
          updateComponents: {
            surfaceId: "s1",
            components: [{ id: "root", component: "Row", text }],
          },
        },
      ],
      status,
      rejected: [],
    };
    runtime.manager.setActiveThread("t1");
    runtime.manager.ingest("t1", "default", content);
    fixture.detectChanges();
    fixture.detectChanges();
  };
  return {
    fixture,
    runtime,
    reportError,
    render,
    element: fixture.nativeElement as HTMLElement,
  };
}

/** jsdom has no layout and no scrollIntoView. */
function mockScrolling(top: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + 100,
  } as DOMRect);
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  return scrollIntoView;
}

describe("CopilotGenerativeUISurface", () => {
  afterEach(() => vi.restoreAllMocks());

  it("registers the target with its description and components", () => {
    const { runtime } = setup(["Row"]);
    expect(runtime.manager.getMountedTargets()).toEqual([
      expect.objectContaining({
        id: "side",
        description: "The side panel",
        components: ["Row"],
      }),
    ]);
  });

  it("ignores a name that is not in the UI and warns about it once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, fixture } = setup(["Row", "Nope"]);
    expect(runtime.manager.getMountedTargets()[0]?.components).toEqual(["Row"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("Nope");
    fixture.componentInstance.components.set(["Row", "Nope"]);
    fixture.detectChanges();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(runtime.manager.getMountedTargets()[0]?.components).toEqual(["Row"]);
  });

  it("warns once when the ui prop is not the UI of the provider", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherUI = createGenerativeUI({
      id: "other",
      components: { Row: { component: Row } },
    });
    const { runtime, fixture } = setup(["Row"], otherUI);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(runtime.manager.getMountedTargets()[0]?.components).toEqual(["Row"]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[generativeUI] <copilot-generative-ui-surface id="side">: the ui input is not the UI of the provider (provideGenerativeUI({ ui })). The components are checked against the UI of the provider.',
    );
  });

  it("shows the fallback until a surface targets it, then the surface", () => {
    const { element, render } = setup();
    expect(element.querySelector("[data-fallback]")).not.toBeNull();
    render("Hello");
    expect(element.querySelector("[data-fallback]")).toBeNull();
    expect(element.querySelector("[data-row]")?.textContent).toBe("Hello");
    expect(
      element
        .querySelector("[data-generative-ui-surface]")
        ?.getAttribute("data-generative-ui-surface"),
    ).toBe("side");
  });

  it("unregisters the target when it is destroyed", () => {
    const { runtime, fixture } = setup();
    expect(runtime.manager.getMountedTargets()).toHaveLength(1);
    fixture.destroy();
    expect(runtime.manager.getMountedTargets()).toHaveLength(0);
  });

  describe("autoScroll", () => {
    it("scrolls to the surface once each time a generation starts", () => {
      const scrollIntoView = mockScrolling(2000);
      const { render } = setup();
      render("First");
      render("First");
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: "start" }),
      );
      // The next render_ui call on the same surface streams again.
      render("First", "ready");
      render("Second");
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it("does not scroll when the surface is already on screen", () => {
      const scrollIntoView = mockScrolling(100);
      const { render } = setup();
      render("First");
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("does not scroll with autoScroll false", () => {
      const scrollIntoView = mockScrolling(2000);
      const { render, fixture } = setup();
      fixture.componentInstance.autoScroll.set(false);
      fixture.detectChanges();
      render("First");
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });
});
