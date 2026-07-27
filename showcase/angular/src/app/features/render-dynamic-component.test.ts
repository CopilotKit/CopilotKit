import type {
  ComponentRef,
  EnvironmentInjector,
  Type,
  ViewContainerRef,
} from "@angular/core";
import {
  EnvironmentInjector as EnvironmentInjectorToken,
  inject,
  InjectionToken,
  Injector,
} from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import {
  createDynamicComponent,
  renderDynamicComponent,
} from "./render-dynamic-component";

describe("renderDynamicComponent", () => {
  it("runs the initial render after dynamic inputs are assigned", () => {
    const detectChanges = vi.fn();
    const component = {
      changeDetectorRef: { detectChanges },
    } as unknown as ComponentRef<unknown>;

    renderDynamicComponent(component);

    expect(detectChanges).toHaveBeenCalledOnce();
  });

  it("renders within the dynamic component injection context", () => {
    const injector = Injector.create({ providers: [] });
    const detectChanges = vi.fn(() => {
      expect(inject(Injector)).toBe(injector);
    });
    const component = {
      injector,
      changeDetectorRef: { detectChanges },
    } as unknown as ComponentRef<unknown>;

    renderDynamicComponent(component);

    expect(detectChanges).toHaveBeenCalledOnce();
  });

  it("creates standalone components within the selected injection context", () => {
    const marker = new InjectionToken<string>("dynamic marker");
    const environmentInjector = {} as EnvironmentInjector;
    const injector = Injector.create({
      providers: [
        { provide: marker, useValue: "available" },
        {
          provide: EnvironmentInjectorToken,
          useValue: environmentInjector,
        },
      ],
    });
    class DynamicComponent {
      readonly marker = "dynamic";
    }
    const component = {} as ComponentRef<DynamicComponent>;
    const createComponent = vi.fn(() => {
      expect(inject(marker)).toBe("available");
      return component;
    });
    const container = {
      injector,
      createComponent,
    } as unknown as ViewContainerRef;

    expect(
      createDynamicComponent(
        container,
        DynamicComponent as Type<DynamicComponent>,
      ),
    ).toBe(component);
    expect(createComponent).toHaveBeenCalledWith(DynamicComponent, {
      environmentInjector,
    });
  });
});
