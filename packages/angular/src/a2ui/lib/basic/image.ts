import { Component, computed } from "@angular/core";
import { ImageApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIBasicComponent } from "./basic-component";

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
      display: block;
    }
    .image {
      display: block;
      width: 100%;
      height: auto;
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
export class CopilotA2UIImage extends CopilotA2UIBasicComponent<
  typeof ImageApi
> {
  protected readonly fit = computed(() => {
    const { variant, fit } = this.props();
    if (variant === "header") return "cover";
    return fit === "scaleDown" ? "scale-down" : fit || "fill";
  });
}
