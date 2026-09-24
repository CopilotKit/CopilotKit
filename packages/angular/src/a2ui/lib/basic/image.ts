import { Component, computed, input } from "@angular/core";
import type { ImageApi } from "@a2ui/web_core/v0_9/basic_catalog";
import type { BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-image",
  template: `
    <img
      class="image"
      [class]="'variant-' + (props().variant ?? 'default')"
      [src]="props().url ?? ''"
      [alt]="props().description ?? ''"
      [style.object-fit]="fit()"
    />
  `,
  styles: `
    :host {
      display: contents;
    }
    .image {
      display: block;
      width: 100%;
      height: auto;
      margin: var(--a2ui-spacing-m, 8px);
      box-sizing: border-box;
    }
    .variant-icon {
      width: 24px;
      height: 24px;
    }
    .variant-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
    }
    .variant-smallFeature {
      max-width: 100px;
    }
    .variant-largeFeature {
      max-height: 400px;
    }
    .variant-header {
      height: 200px;
    }
  `,
})
export class CopilotA2UIImage {
  readonly props = input.required<BasicProps<typeof ImageApi>>();

  protected readonly fit = computed(() => {
    const { variant, fit } = this.props();
    if (variant === "header") return "cover";
    return fit === "scaleDown" ? "scale-down" : fit || "fill";
  });
}
