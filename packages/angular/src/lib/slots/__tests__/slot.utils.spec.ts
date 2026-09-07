import {
  Component,
  createEnvironmentInjector,
  EnvironmentInjector,
  input,
  runInInjectionContext,
  TemplateRef,
  viewChild,
  ViewContainerRef,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { assertDefined } from "../../utils";
import { SLOT_CONFIG } from "../slot.types";
import {
  createSlotConfig,
  createSlotRenderer,
  getSlotConfig,
  isComponentType,
  isSlotValue,
  normalizeSlotValue,
  provideSlots,
  renderSlot,
} from "../slot.utils";

@Component({
  selector: "default-component",
  template: `
    <div data-testid="default">{{ text() }}</div>
  `,
})
class DefaultComponent {
  readonly text = input("Default");
}

@Component({
  selector: "custom-component",
  template: `
    <div data-testid="custom">{{ text() }}</div>
  `,
})
class CustomComponent {
  readonly text = input("Custom");
}

@Component({
  selector: "props-component",
  template: `
    <div data-testid="props">{{ props().text }}</div>
  `,
})
class PropsComponent {
  protected readonly props = input({ text: "Default" });
}

describe("slot utils", () => {
  describe("renderSlot", () => {
    it("renders default component when no slot provided", async () => {
      @Component({
        template: `
          <div #container></div>
        `,
        imports: [DefaultComponent],
      })
      class HostComponent {
        container = viewChild.required("container", { read: ViewContainerRef });
      }

      const fixture = TestBed.createComponent(HostComponent);
      await fixture.whenStable();

      const container = fixture.componentInstance.container();
      assertDefined(container);

      renderSlot(container, {
        defaultComponent: DefaultComponent,
      });

      await expect
        .poll(() => document.querySelector('[data-testid="default"]'))
        .toBeTruthy();
    });

    it("renders template slot with provided context", async () => {
      @Component({
        template: `
          <div #container></div>
          <ng-template #tpl let-props="props">
            <span data-testid="template">{{ props?.value }}</span>
          </ng-template>
        `,
      })
      class HostComponent {
        container = viewChild.required("container", { read: ViewContainerRef });
        tpl = viewChild.required<TemplateRef<unknown>>("tpl");
      }

      const fixture = TestBed.createComponent(HostComponent);
      await fixture.whenStable();
      const container = fixture.componentInstance.container();
      const tpl = fixture.componentInstance.tpl();

      assertDefined(container);
      assertDefined(tpl);

      renderSlot(container, {
        defaultComponent: DefaultComponent,
        slot: tpl,
        props: { value: "from template" },
      });

      await expect
        .poll(
          () => document.querySelector('[data-testid="template"]')?.textContent,
        )
        .toContain("from template");
    });

    it("binds declared inputs on the next change detection", async () => {
      @Component({
        template: `
          <div #container></div>
        `,
        imports: [DefaultComponent],
      })
      class HostComponent {
        container = viewChild.required("container", { read: ViewContainerRef });
      }

      const fixture = TestBed.createComponent(HostComponent);
      await fixture.whenStable();

      const container = fixture.componentInstance.container();
      assertDefined(container);

      renderSlot(container, {
        defaultComponent: DefaultComponent,
        props: { text: "Updated" },
      });

      await expect
        .poll(
          () => document.querySelector('[data-testid="default"]')?.textContent,
        )
        .toContain("Updated");
    });

    it("binds the full context to a legacy props input", async () => {
      @Component({
        template: `
          <div #container></div>
        `,
        imports: [PropsComponent],
      })
      class HostComponent {
        container = viewChild.required("container", { read: ViewContainerRef });
      }

      const fixture = TestBed.createComponent(HostComponent);
      await fixture.whenStable();

      const container = fixture.componentInstance.container();
      assertDefined(container);

      renderSlot(container, {
        defaultComponent: PropsComponent,
        props: { text: "Updated" },
      });

      await expect
        .poll(
          () => document.querySelector('[data-testid="props"]')?.textContent,
        )
        .toContain("Updated");
    });
  });

  describe("type guards", () => {
    it("detects component types", () => {
      expect(isComponentType(DefaultComponent)).toBe(true);
      expect(isComponentType(class NotAnAngularComponent {})).toBe(false);
      expect(isComponentType(() => {})).toBe(false);
      expect(isComponentType(null)).toBe(false);
    });

    it("detects slot values", async () => {
      @Component({
        template: `
          <ng-template #tpl></ng-template>
        `,
      })
      class HostComponent {
        tpl = viewChild.required<TemplateRef<unknown>>("tpl");
      }

      const fixture = TestBed.createComponent(HostComponent);
      await fixture.whenStable();

      const tpl = fixture.componentInstance.tpl();
      assertDefined(tpl);

      expect(isSlotValue(DefaultComponent)).toBe(true);
      expect(isSlotValue(tpl)).toBe(true);
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
        { button: DefaultComponent, toolbar: DefaultComponent },
      );

      expect(config.get("button")).toEqual({ component: CustomComponent });
      expect(config.get("toolbar")).toEqual({ component: DefaultComponent });
    });

    it("provides and retrieves slot configuration via DI", () => {
      const slots = new Map([["button", { component: CustomComponent }]]);
      TestBed.configureTestingModule({
        providers: [{ provide: SLOT_CONFIG, useValue: slots }],
      });

      @Component({ template: "" })
      class HostComponent {
        config = getSlotConfig();
      }

      const fixture = TestBed.createComponent(HostComponent);
      expect(fixture.componentInstance.config).toBe(slots);
    });

    it("createSlotRenderer uses DI overrides when slot name provided", async () => {
      const parent = TestBed.inject(EnvironmentInjector);
      const env = createEnvironmentInjector(
        [provideSlots({ button: CustomComponent })],
        parent,
      );

      const renderer = runInInjectionContext(env, () =>
        createSlotRenderer(DefaultComponent, "button"),
      );

      @Component({
        template: `
          <div #container></div>
        `,
        imports: [DefaultComponent, CustomComponent],
      })
      class HostComponent {
        container = viewChild.required("container", { read: ViewContainerRef });
      }

      const fixture = TestBed.createComponent(HostComponent);
      await fixture.whenStable();

      const container = fixture.componentInstance.container();
      assertDefined(container);

      renderer(container);

      await expect
        .poll(() => document.querySelector('[data-testid="custom"]'))
        .toBeTruthy();
    });
  });
});
