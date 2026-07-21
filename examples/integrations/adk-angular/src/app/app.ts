import { Component, signal } from "@angular/core";
import {
  CopilotChat,
  CopilotThreadsDrawer,
  registerFrontendTool,
} from "@copilotkit/angular";
import { z } from "zod";
import { AGENT_ID } from "./app.config";
import { MainContent } from "./main-content";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CopilotChat, CopilotThreadsDrawer, MainContent],
  template: `
    <!--
      Set the theme custom property on the layout ROOT so it cascades into both
      the center panel and the chat column. The weather card is rendered inside
      <copilot-chat> (a sibling of the center panel), so a variable scoped to the
      center alone never reaches it — mirror React, where the themed <main> wraps
      both the content and the chat.
    -->
    <div class="layout" [style.--copilot-kit-primary-color]="themeColor()">
      <!-- License-gated: locked "Upgrade" tease when unlicensed, threads when licensed. -->
      <copilot-threads-drawer [agentId]="AGENT_ID" class="drawer" />
      <app-main-content [themeColor]="themeColor()" class="center" />
      <div class="chat">
        <copilot-chat [agentId]="AGENT_ID" />
      </div>
    </div>
  `,
  styles: [
    `
      .layout {
        display: grid;
        grid-template-columns:
          var(--cpk-drawer-reserved-width, 320px) minmax(0, 1fr)
          420px;
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
        border-left: 1px solid rgba(0, 0, 0, 0.08);
        height: 100dvh;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .chat copilot-chat {
        display: block;
        flex: 1;
        min-height: 0;
      }
      /*
        Mobile: stack the center panel above the chat in a single column so the
        assistant stays reachable (the drawer is desktop-only here — hiding the
        whole chat would leave mobile users with no way to talk to the agent).
      */
      @media (max-width: 900px) {
        .layout {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto minmax(0, 1fr);
        }
        .drawer {
          display: none;
        }
        .chat {
          border-left: none;
          border-top: 1px solid rgba(0, 0, 0, 0.08);
        }
      }
    `,
  ],
})
export class App {
  protected readonly AGENT_ID = AGENT_ID;
  protected readonly themeColor = signal("#6366f1");

  constructor() {
    // 🪁 Frontend tool: let the agent recolor the center panel.
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
