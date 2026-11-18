import { Component, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { CopilotChat, provideCopilotChatLabels } from "@copilotkit/angular";
import {
  CopilotGenerativeUISurface,
  connectGenerativeUIState,
  registerGenerativeUIFunction,
} from "@copilotkit/angular/generative-ui";
import { shopUI } from "./shop-ui";
import type { CartItem } from "./shop-ui";

/**
 * Chat with the scripted `generative-ui` agent (no API key needed). It
 * renders a surface of the standard catalog in the chat: a Card with a
 * Title, a Chart, a Table, a TextField bound to the data model and two
 * Buttons that send events back to the agent. The page also has a named
 * surface target, `side`, that an agent can render into.
 */
@Component({
  selector: "generative-ui-demo",
  imports: [CopilotChat, CopilotGenerativeUISurface, RouterLink],
  providers: [
    provideCopilotChatLabels({
      chatInputPlaceholder:
        'Say anything to see the store, "shop" for the cart, or "everything" for the whole catalog…',
    }),
  ],
  template: `
    <div class="layout">
      <aside class="explainer">
        <h1>Native generative UI</h1>
        <p><a routerLink="/generative-ui/catalog">All standard components →</a></p>
        <p>
          The agent sends A2UI operations for this app's catalog: the standard
          catalog (<code>copilotkit/standard@1</code>) plus two components of the
          app. The native Angular components of
          <code>&#64;copilotkit/angular/generative-ui</code> render them, wired up
          in <code>app.config.ts</code>:
        </p>
        <pre><code>{{ snippet }}</code></pre>
        <p>
          The text field writes to the surface data model, and the buttons send user
          events to the agent. Below is a named target: an agent can render into it
          with <code>target=side</code>. "Where to buy" renders a Map here
          (<code>provideGenerativeUIMap()</code>, MapLibre loads on first use).
        </p>
        <p>
          "Shop" renders a form with two components of this app: ProductCard calls
          the app's <code>addToCart</code> function, and CartSummary is bound to the
          app's cart state ({{ cart().length }} lines), so the UI changes with no
          agent round trip. Checkout sends the cart to the agent.
        </p>
        <copilot-generative-ui-surface
          id="side"
          description="A panel next to the chat. Use it for anything the user should keep while they chat."
        >
          <p class="placeholder">Nothing here yet.</p>
        </copilot-generative-ui-surface>
      </aside>
      <copilot-chat class="chat" agentId="generative-ui" />
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(280px, 420px) 1fr;
      height: 100%;
    }
    .explainer {
      overflow: auto;
      padding: 24px;
      border-right: 1px solid #e5e7eb;
      font-size: 14px;
      line-height: 1.5;
    }
    .explainer h1 {
      margin: 0 0 12px;
      font-size: 20px;
    }
    .explainer pre {
      overflow: auto;
      padding: 12px;
      border-radius: 8px;
      background: #f3f4f6;
      font-size: 12px;
    }
    .placeholder {
      padding: 12px;
      border: 1px dashed #d1d5db;
      border-radius: 8px;
      color: #6b7280;
    }
    .chat {
      min-width: 0;
      height: 100%;
    }
  `,
})
export class GenerativeUIDemoComponent {
  /** The cart is app state. The shop surface reads it through the catalog's `bind`. */
  protected readonly cart = signal<CartItem[]>([]);

  constructor() {
    connectGenerativeUIState(shopUI, "cart", () => ({ items: this.cart() }));
    registerGenerativeUIFunction(shopUI, "addToCart", (item) => {
      this.cart.update((items) => {
        const same = items.find(
          (line) =>
            line.productId === item.productId &&
            line.size === item.size &&
            line.gift === item.gift,
        );
        return same
          ? items.map((line) =>
              line === same
                ? { ...line, quantity: line.quantity + item.quantity }
                : line,
            )
          : [...items, item];
      });
    });
  }

  protected readonly snippet = `provideGenerativeUI({ ui: shopUI }) // standardUI + ProductCard + CartSummary
provideGenerativeUIChart()
provideGenerativeUIMap()

// in a page:
<copilot-generative-ui-surface id="side"
  description="A panel next to the chat">
  <p>Fallback until the agent renders here</p>
</copilot-generative-ui-surface>`;
}
