import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { CopilotIcon, MessageCircle, X } from "../icons/copilot-icon";

const ICON_TRANSITION =
  "opacity 120ms ease-out, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Round launcher for `<copilot-popup>` / `<copilot-sidebar>`, matching React's
 * `CopilotChatToggleButton`: a chat bubble that turns into an X while open.
 * Applied to a native `<button>` so the host keeps button semantics.
 */
@Component({
  selector: "button[copilotChatToggleButton]",
  imports: [CopilotIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    type: "button",
    class:
      "copilotKitButton cpk:fixed cpk:bottom-[max(1.5rem,env(safe-area-inset-bottom))] cpk:right-[max(1.5rem,env(safe-area-inset-right))] cpk:z-[1100] cpk:flex cpk:h-14 cpk:w-14 cpk:items-center cpk:justify-center cpk:rounded-full cpk:border-0 cpk:bg-primary cpk:text-primary-foreground cpk:shadow-[0_1px_2px_0_rgb(0_0_0/0.10),0_8px_24px_-6px_rgb(0_0_0/0.25)] cpk:ring-1 cpk:ring-foreground/5 cpk:transition-[transform,scale,box-shadow] cpk:duration-200 cpk:ease-out cpk:hover:scale-[1.04] cpk:hover:shadow-[0_2px_4px_0_rgb(0_0_0/0.12),0_12px_32px_-8px_rgb(0_0_0/0.30)] cpk:cursor-pointer cpk:active:scale-[0.96] cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-primary/50 cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background cpk:disabled:pointer-events-none cpk:disabled:opacity-60 cpk:data-[position=left]:left-[max(1.5rem,env(safe-area-inset-left))] cpk:data-[position=left]:right-auto",
    "data-copilotkit": "",
    "data-testid": "copilot-chat-toggle",
    "data-slot": "chat-toggle-button",
    "[attr.data-state]": "open() ? 'open' : 'closed'",
    "[attr.data-position]": "position()",
    "[attr.aria-label]": "open() ? closeLabel() : openLabel()",
    "[attr.aria-expanded]": "open()",
  },
  template: `
    <span
      aria-hidden="true"
      data-slot="chat-toggle-button-open-icon"
      class="cpk:pointer-events-none cpk:absolute cpk:inset-0 cpk:flex cpk:items-center cpk:justify-center cpk:will-change-transform cpk:[&_svg]:fill-current cpk:[&_svg]:stroke-[1.75]"
      [style.transition]="transition"
      [style.opacity]="open() ? 0 : 1"
      [style.transform]="
        open() ? 'scale(0.75) rotate(90deg)' : 'scale(1) rotate(0deg)'
      "
    >
      <copilot-icon [img]="MessageCircle" [size]="24" />
    </span>
    <span
      aria-hidden="true"
      data-slot="chat-toggle-button-close-icon"
      class="cpk:pointer-events-none cpk:absolute cpk:inset-0 cpk:flex cpk:items-center cpk:justify-center cpk:will-change-transform cpk:[&_svg]:stroke-[1.75]"
      [style.transition]="transition"
      [style.opacity]="open() ? 1 : 0"
      [style.transform]="
        open() ? 'scale(1) rotate(0deg)' : 'scale(0.75) rotate(-90deg)'
      "
    >
      <copilot-icon [img]="X" [size]="24" />
    </span>
  `,
})
export class CopilotChatToggleButton {
  readonly open = input(false);
  readonly position = input<"left" | "right">("right");
  /** Accessible name while closed. */
  readonly openLabel = input("Open chat");
  /** Accessible name while open. */
  readonly closeLabel = input("Close chat");

  protected readonly MessageCircle = MessageCircle;
  protected readonly X = X;
  protected readonly transition = ICON_TRANSITION;
}
