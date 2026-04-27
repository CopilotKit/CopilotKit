import { Tip, TipState, TipStrategy } from "../types.js";

export class RandomStrategy implements TipStrategy {
  select(tips: Tip[], _state: TipState): Tip | null {
    if (tips.length === 0) return null;
    const index = Math.floor(Math.random() * tips.length);
    return tips[index];
  }
}
