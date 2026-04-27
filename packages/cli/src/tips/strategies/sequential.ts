import { Tip, TipState, TipStrategy } from "../types.js";

export class SequentialStrategy implements TipStrategy {
  select(tips: Tip[], state: TipState): Tip | null {
    if (tips.length === 0) return null;
    if (state.shownTipIds.length === 0) return tips[0];

    const lastShownId = state.shownTipIds[state.shownTipIds.length - 1];
    const lastIndex = tips.findIndex((t) => t.id === lastShownId);

    if (lastIndex === -1) return tips[0];

    const nextIndex = (lastIndex + 1) % tips.length;
    return tips[nextIndex];
  }
}
