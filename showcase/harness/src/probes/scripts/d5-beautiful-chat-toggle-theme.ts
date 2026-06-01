/**
 * D5 — beautiful-chat / Toggle Theme.
 *
 * Single-turn probe asserting the `toggleTheme` frontend tool fires
 * and flips `document.documentElement.classList`. Part of the
 * `beautiful-chat-*` family — see `_beautiful-chat-shared.ts` for
 * the rationale on per-pill scripts and the assertion implementation.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";
import {
  assertToggleTheme,
  preNavigateBeautifulChat,
} from "./_beautiful-chat-shared.js";

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "d5 beautiful-chat probe: toggle the theme",
      assertions: assertToggleTheme,
    },
  ];
}

registerD5Script({
  featureTypes: ["beautiful-chat-toggle-theme"],
  fixtureFile: "beautiful-chat-toggle-theme.json",
  buildTurns,
  preNavigateRoute: preNavigateBeautifulChat,
});
