import { Tip, TipState, TipStrategy } from "../types.js";

export interface WeightedRandomOptions {
  noRepeatCount?: number;
}

export class WeightedRandomStrategy implements TipStrategy {
  private noRepeatCount: number;

  constructor(options?: WeightedRandomOptions) {
    this.noRepeatCount = options?.noRepeatCount ?? 0;
  }

  select(tips: Tip[], state: TipState): Tip | null {
    if (tips.length === 0) return null;

    let candidates = tips;

    if (this.noRepeatCount > 0) {
      const recentIds = state.shownTipIds.slice(-this.noRepeatCount);
      const recentSet = new Set(recentIds);
      candidates = tips.filter((t) => !recentSet.has(t.id));
    }

    if (candidates.length === 0) return null;

    const totalWeight = candidates.reduce((sum, t) => sum + (t.weight ?? 1), 0);
    let random = Math.random() * totalWeight;

    for (const tip of candidates) {
      random -= tip.weight ?? 1;
      if (random <= 0) return tip;
    }

    return candidates[candidates.length - 1];
  }
}
