import type { ComponentRef } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { renderDynamicComponent } from "./render-dynamic-component";

describe("renderDynamicComponent", () => {
  it("runs the initial render after dynamic inputs are assigned", () => {
    const detectChanges = vi.fn();
    const component = {
      changeDetectorRef: { detectChanges },
    } as unknown as ComponentRef<unknown>;

    renderDynamicComponent(component);

    expect(detectChanges).toHaveBeenCalledOnce();
  });
});
