import { Component, signal } from "@angular/core";
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
    <div class="layout">
      <!-- License-gated: locked "Upgrade" tease when unlicensed, threads when licensed. -->
      <copilot-threads-drawer [agentId]="AGENT_ID" class="drawer" />
      <app-main-content [themeColor]="themeColor()" class="center" />
    </div>

    <!--
      Floating, collapsible chat. Angular has no CopilotSidebar, so this is a
      hand-rolled slide-over that OVERLAYS the content (it doesn't reserve a
      column). That keeps the threads drawer's desktop push from smushing the
      content, and mirrors React's CopilotSidebar feel (dock right, closeable).
    -->
    <aside class="chat" [class.chat--open]="chatOpen()" aria-label="Assistant">
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

    <!-- Always-visible toggle FAB (React's CopilotChatToggleButton): MessageCircle
         when closed, X when open; bottom-right, primary-dark. -->
    <button
      type="button"
      class="chat-fab"
      (click)="chatOpen.set(!chatOpen())"
      [attr.aria-label]="chatOpen() ? 'Close chat' : 'Open chat'"
    >
      <lucide-angular [img]="chatOpen() ? CloseIcon : ChatIcon" [size]="24" />
    </button>

    <!-- Dev-only floating inspector (mounts into <body>). Remove for production. -->
    <app-web-inspector />
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .layout {
        display: grid;
        /* Two tracks — drawer (pushed via the SDK's reserved-width var) + content.
           The chat is a fixed overlay, NOT a grid column, so it never smushes the
           content when the drawer expands. */
        grid-template-columns: var(--cpk-drawer-reserved-width, 320px) minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
        height: 100dvh;
        width: 100%;
        overflow: hidden;
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
        z-index: 50;
        height: 100dvh;
        width: min(440px, 100%);
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
  /** Chat starts open (mirrors React's `defaultOpen` CopilotSidebar). */
  protected readonly chatOpen = signal(true);
  /** lucide icons matching React's sidebar (X for close, MessageCircle to open). */
  protected readonly CloseIcon = X;
  protected readonly ChatIcon = MessageCircle;

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
