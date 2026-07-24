import { Component, isDevMode, signal } from "@angular/core";
import {
  CopilotChat,
  CopilotThreadsDrawer,
  registerFrontendTool,
} from "@copilotkit/angular";
import { LucideAngularModule, MessageCircle, X } from "lucide-angular";
import { z } from "zod";
import { AGENT_ID } from "./app.config";
import { MainContent } from "./main-content";
import { WebInspector } from "./web-inspector";

/**
 * Viewport width (px) at/above which an open chat DOCKS and pushes the content
 * left; below it the chat overlays. Keep in sync with the `@media (min-width…)`
 * rule in the component styles.
 */
const DOCK_BREAKPOINT_PX = 1200;

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CopilotChat,
    CopilotThreadsDrawer,
    MainContent,
    WebInspector,
    LucideAngularModule,
  ],
  // Expose the theme on the HOST (an ancestor of both the layout and the
  // floating chat) via a demo-specific variable so the generative-UI weather
  // card — rendered inside <copilot-chat>, which now lives in a fixed slide-over
  // outside .layout — still inherits it (custom properties inherit through
  // fixed-positioned descendants). We deliberately do NOT reuse
  // --copilot-kit-primary-color: the chat re-declares that token on its own
  // [data-copilotkit] hosts, which would shadow the value set here.
  host: { "[style.--app-theme-color]": "themeColor()" },
  template: `
    <div class="layout" [class.layout--pushed]="chatOpen()">
      <!-- License-gated: locked "Upgrade" tease when unlicensed, threads when licensed. -->
      <copilot-threads-drawer [agentId]="AGENT_ID" class="drawer" />
      <app-main-content [themeColor]="themeColor()" class="center" />
    </div>

    <!--
      Collapsible chat (Angular has no CopilotSidebar, so it's hand-rolled).
      Mirrors React: when there's room (wide viewport) it DOCKS and pushes the
      content left — .layout--pushed adds a right margin equal to the chat width;
      on narrower screens it OVERLAYS instead so the content isn't smushed.
      Closeable via the header X.
    -->
    <!-- inert while closed: the panel is only translated off-screen, so without
         this its inputs/buttons stay in the tab order and screen-reader tree. -->
    <aside
      class="chat"
      [class.chat--open]="chatOpen()"
      [attr.inert]="chatOpen() ? null : ''"
      aria-label="Assistant"
    >
      <header class="chat__bar">
        <span>Assistant</span>
        <button
          type="button"
          class="chat__close"
          (click)="chatOpen.set(false)"
          aria-label="Close chat"
        >
          <lucide-angular [img]="CloseIcon" [size]="20" />
        </button>
      </header>
      <copilot-chat [agentId]="AGENT_ID" />
    </aside>

    <!-- Toggle FAB (React's CopilotChatToggleButton): always a MessageCircle,
         bottom-right, primary-dark. When the chat is open the panel (higher
         z-index) covers it, so the only visible close is the header X — matching
         React, which never shows a bottom-right X. -->
    <button
      type="button"
      class="chat-fab"
      (click)="chatOpen.set(!chatOpen())"
      [attr.aria-label]="chatOpen() ? 'Close chat' : 'Open chat'"
    >
      <lucide-angular [img]="ChatIcon" [size]="24" />
    </button>

    <!-- Dev-only floating inspector (mounts into <body>). @defer keeps it — and
         its @copilotkit/web-inspector dependency — out of the production initial
         bundle: in a prod build isDev is false, so the deferred chunk never loads. -->
    @defer (when isDev) {
      <app-web-inspector />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        --chat-width: 440px;
      }
      .layout {
        display: grid;
        /* Two tracks — drawer (pushed via the SDK's reserved-width var) + content.
           The chat is a fixed panel, NOT a grid column. When docked (wide + open)
           .layout--pushed adds a right margin so the content reflows beside it
           instead of being covered; below the dock breakpoint the chat overlays. */
        grid-template-columns: var(--cpk-drawer-reserved-width, 320px) minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
        height: 100dvh;
        overflow: hidden;
        transition: margin-inline-end 0.25s ease;
      }
      /* Dock breakpoint — keep in sync with DOCK_BREAKPOINT_PX in the component.
         Above it, an open chat pushes the content; below, it overlays. */
      @media (min-width: 1200px) {
        .layout--pushed {
          margin-inline-end: var(--chat-width);
        }
      }
      .center {
        min-width: 0;
        height: 100dvh;
        overflow: hidden;
      }
      .chat {
        position: fixed;
        top: 0;
        right: 0;
        /* Above the toggle FAB (z 1100) so an open panel covers it — like
           React's z-1200 sidebar over its z-1100 toggle button. */
        z-index: 1200;
        height: 100dvh;
        width: min(var(--chat-width), 100%);
        display: flex;
        flex-direction: column;
        background: #fff;
        border-left: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: -12px 0 32px rgba(0, 0, 0, 0.12);
        transform: translateX(100%);
        transition: transform 0.25s ease;
      }
      .chat--open {
        transform: translateX(0);
      }
      /* React's CopilotModalHeader: title left, close right, justify-between,
         border-b, px-4 py-4. */
      .chat__bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem;
        border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        font-weight: 600;
        font-size: 0.95rem;
      }
      .chat__close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        background: transparent;
        cursor: pointer;
        padding: 0.25rem;
        border-radius: 0.375rem;
        color: inherit;
      }
      .chat__close:hover {
        background: rgba(0, 0, 0, 0.06);
      }
      .chat copilot-chat {
        display: block;
        flex: 1;
        min-height: 0;
      }
      /* React's CopilotChatToggleButton: fixed bottom-6 right-6, h-14 w-14,
         rounded-full, primary bg, z-1100. */
      .chat-fab {
        position: fixed;
        right: 1.5rem;
        bottom: 1.5rem;
        z-index: 1100;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 3.5rem;
        width: 3.5rem;
        border-radius: 9999px;
        border: 0;
        background: #171717;
        color: #fff;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease;
      }
      .chat-fab:hover {
        transform: scale(1.04);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
      }
      /* Mobile: the SDK drawer becomes an off-canvas modal at <=768px, so collapse
         the grid to a single content column; the chat overlays full-width. */
      @media (max-width: 768px) {
        .layout {
          grid-template-columns: minmax(0, 1fr);
        }
        .chat {
          width: 100%;
        }
      }
    `,
  ],
})
export class App {
  protected readonly AGENT_ID = AGENT_ID;
  protected readonly themeColor = signal("#6366f1");
  /** Start expanded only when there's room to dock (wide viewport); on narrow
   *  screens start closed so the overlay doesn't cover the content on load. */
  protected readonly chatOpen = signal(
    typeof window !== "undefined"
      ? window.innerWidth >= DOCK_BREAKPOINT_PX
      : true,
  );
  /** lucide icons matching React's sidebar (X for close, MessageCircle to open). */
  protected readonly CloseIcon = X;
  protected readonly ChatIcon = MessageCircle;
  /** Dev-only: gates the @defer'd web inspector so it stays out of prod builds. */
  protected readonly isDev = isDevMode();

  constructor() {
    // 🪁 Frontend tool: recolor the center panel (and, via --app-theme-color on
    // the host, the generative-UI weather card in the chat).
    registerFrontendTool({
      name: "setThemeColor",
      description: "Set the theme color of the page.",
      parameters: z.object({
        themeColor: z
          .string()
          .describe("The theme color to set. Make sure to pick nice colors."),
      }),
      handler: async ({ themeColor }) => {
        this.themeColor.set(themeColor);
        return `Changing theme color to ${themeColor}`;
      },
      agentId: AGENT_ID,
    });
  }
}
