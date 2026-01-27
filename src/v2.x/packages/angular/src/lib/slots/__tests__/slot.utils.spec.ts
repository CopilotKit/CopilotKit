import {
  Component,
  Input,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  renderSlot,
  isComponentType,
  isSlotValue,
  normalizeSlotValue,
  createSlotConfig,
  provideSlots,
  getSlotConfig,
  createSlotRenderer,
} from "../slot.utils";
import { SLOT_CONFIG } from "../slot.types";

@Component({
  standalone: true,
  selector: "default-component",
  template: `<div class="default">{{ text }}</div>`,
})
class DefaultComponent {
  @Input() text = "Default";
}

@Component({
  standalone: true,
  selector: "custom-component",
  template: `<div class="custom">{{ text }}</div>`,
})
class CustomComponent {
  @Input() text = "Custom";
}

describe("slot utils", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  describe("renderSlot", () => {
    it("renders default component when no slot provided", () => {
      @Component({
        standalone: true,
        template: `<div #container></div>`,
        imports: [DefaultComponent],
      })
      class HostComponent {
        @ViewChild("container", { read: ViewContainerRef })
        container!: ViewContainerRef;
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      const ref = renderSlot(fixture.componentInstance.container, {
        defaultComponent: DefaultComponent,
      });

      expect(ref).toBeTruthy();
      expect(
        (ref as any).location.nativeElement.querySelector(".default")
      ).toBeTruthy();
    });

    it("renders template slot with provided context", () => {
      @Component({
        standalone: true,
        template: `
          <div #container></div>
          <ng-template #tpl let-props="props">
            <span class="template">{{ props?.value }}</span>
          </ng-template>
        `,
      })
      class HostComponent {
        @ViewChild("container", { read: ViewContainerRef })
        container!: ViewContainerRef;
        @ViewChild("tpl") tpl!: TemplateRef<any>;
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      renderSlot(fixture.componentInstance.container, {
        defaultComponent: DefaultComponent,
        slot: fixture.componentInstance.tpl,
        props: { value: "from template" },
      });
      fixture.detectChanges();

      const span = fixture.nativeElement.querySelector(".template");
      expect(span?.textContent?.trim()).toBe("from template");
    });

    it("applies inputs using setInput", () => {
      @Component({
        standalone: true,
        template: `<div #container></div>`,
        imports: [DefaultComponent],
      })
      class HostComponent {
        @ViewChild("container", { read: ViewContainerRef })
        container!: ViewContainerRef;
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      const ref = renderSlot(fixture.componentInstance.container, {
        defaultComponent: DefaultComponent,
        props: { text: "Updated" },
      });

      expect(ref).toBeTruthy();
      expect((ref as any).instance.text).toBe("Updated");
    });
  });

  describe("type guards", () => {
    it("detects component types", () => {
      expect(isComponentType(DefaultComponent)).toBe(true);
      expect(isComponentType(() => {})).toBe(false);
      expect(isComponentType(null)).toBe(false);
    });

    it("detects slot values", () => {
      @Component({
        standalone: true,
        template: `<ng-template #tpl></ng-template>`,
      })
      class HostComponent {
        @ViewChild("tpl") tpl!: TemplateRef<any>;
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      expect(isSlotValue(DefaultComponent)).toBe(true);
      expect(isSlotValue(fixture.componentInstance.tpl)).toBe(true);
      expect(isSlotValue("string")).toBe(false);
    });
  });

  describe("configuration helpers", () => {
    it("normalises slot overrides to registry entries", () => {
      expect(normalizeSlotValue(undefined, DefaultComponent)).toEqual({
        component: DefaultComponent,
      });
      expect(normalizeSlotValue(CustomComponent, DefaultComponent)).toEqual({
        component: CustomComponent,
      });
    });

    it("creates slot configuration map with defaults", () => {
      const config = createSlotConfig(
        { button: CustomComponent },
        { button: DefaultComponent, toolbar: DefaultComponent }
      );

      expect(config.get("button")).toEqual({ component: CustomComponent });
      expect(config.get("toolbar")).toEqual({ component: DefaultComponent });
    });

    it("provides and retrieves slot configuration via DI", () => {
      const slots = new Map([["button", { component: CustomComponent }]]);
      TestBed.configureTestingModule({
        providers: [{ provide: SLOT_CONFIG, useValue: slots }],
      });

      @Component({ standalone: true, template: "" })
      class HostComponent {
        config = getSlotConfig();
      }

      const fixture = TestBed.createComponent(HostComponent);
      expect(fixture.componentInstance.config).toBe(slots);
    });

    it("createSlotRenderer uses DI overrides when slot name provided", () => {
      const parent = TestBed.inject(EnvironmentInjector);
      const env = createEnvironmentInjector(
        [provideSlots({ button: CustomComponent })],
        parent
      );

      const renderer = runInInjectionContext(env, () =>
        createSlotRenderer(DefaultComponent, "button")
      );

      @Component({
        standalone: true,
        template: `<div #container></div>`,
        imports: [DefaultComponent, CustomComponent],
      })
      class HostComponent {
        @ViewChild("container", { read: ViewContainerRef })
        container!: ViewContainerRef;
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      const ref = renderer(fixture.componentInstance.container);
      expect(
        (ref as any).location.nativeElement.querySelector(".custom")
      ).toBeTruthy();
    });
  });
});
