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
    <div class="layout">
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
      @media (max-width: 900px) {
        .layout {
          grid-template-columns: minmax(0, 1fr);
        }
        .drawer,
        .chat {
          display: none;
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
