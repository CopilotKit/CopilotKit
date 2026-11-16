import { Directive, computed, input } from "@angular/core";
import type { LayoutProps } from "@copilotkit/shared/generative-ui";

/**
 * The inputs of the shared layout props (`layoutProps` in shared). Pressable
 * and Form extend it; the renderer binds each prop the component declares.
 */
@Directive()
export abstract class CopilotGenerativeUILayoutInputs {
  readonly align = input<LayoutProps["align"]>();
  readonly justify = input<LayoutProps["justify"]>();
  readonly wrap = input<LayoutProps["wrap"]>();
  readonly gap = input<LayoutProps["gap"]>();
  readonly rowGap = input<LayoutProps["rowGap"]>();
  readonly columnGap = input<LayoutProps["columnGap"]>();
  readonly padding = input<LayoutProps["padding"]>();
  readonly background = input<LayoutProps["background"]>();
  readonly border = input<LayoutProps["border"]>();
  readonly borderColor = input<LayoutProps["borderColor"]>();
  readonly radius = input<LayoutProps["radius"]>();
  readonly width = input<LayoutProps["width"]>();
  readonly height = input<LayoutProps["height"]>();
  readonly minWidth = input<LayoutProps["minWidth"]>();
  readonly maxWidth = input<LayoutProps["maxWidth"]>();
  readonly minHeight = input<LayoutProps["minHeight"]>();
  readonly maxHeight = input<LayoutProps["maxHeight"]>();
  readonly flex = input<LayoutProps["flex"]>();
  readonly weight = input<LayoutProps["weight"]>();
  readonly aspectRatio = input<LayoutProps["aspectRatio"]>();
  readonly scrollable = input<LayoutProps["scrollable"]>();
  readonly clip = input<LayoutProps["clip"]>();
  readonly shadow = input<LayoutProps["shadow"]>();
  readonly inline = input<LayoutProps["inline"]>();
  readonly role = input<LayoutProps["role"]>();
  readonly flush = input<LayoutProps["flush"]>();
  readonly minSize = input<LayoutProps["minSize"]>();
  readonly maxSize = input<LayoutProps["maxSize"]>();
  readonly disableAutoSpacing = input<LayoutProps["disableAutoSpacing"]>();

  /** The layout props as one object, for `layoutStyle`. */
  protected readonly layoutProps = computed<LayoutProps>(() => ({
    align: this.align(),
    justify: this.justify(),
    wrap: this.wrap(),
    gap: this.gap(),
    rowGap: this.rowGap(),
    columnGap: this.columnGap(),
    padding: this.padding(),
    background: this.background(),
    border: this.border(),
    borderColor: this.borderColor(),
    radius: this.radius(),
    width: this.width(),
    height: this.height(),
    minWidth: this.minWidth(),
    maxWidth: this.maxWidth(),
    minHeight: this.minHeight(),
    maxHeight: this.maxHeight(),
    flex: this.flex(),
    weight: this.weight(),
    aspectRatio: this.aspectRatio(),
    scrollable: this.scrollable(),
    clip: this.clip(),
    shadow: this.shadow(),
    inline: this.inline(),
    role: this.role(),
    flush: this.flush(),
    minSize: this.minSize(),
    maxSize: this.maxSize(),
    disableAutoSpacing: this.disableAutoSpacing(),
  }));
}
