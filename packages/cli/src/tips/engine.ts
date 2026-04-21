import { Tip, TipStrategy, TipRenderer, TipStore } from "./types.js";

export interface TipEngineOptions {
  tips: Tip[];
  strategy: TipStrategy;
  renderer: TipRenderer;
  store: TipStore;
}

export class TipEngine {
  constructor(private options: TipEngineOptions) {}

  async show(log: (msg: string) => void): Promise<void> {
    const state = await this.options.store.load();
    const tip = this.options.strategy.select(this.options.tips, state);
    if (!tip) return;

    this.options.renderer.render(tip, log);

    state.shownTipIds.push(tip.id);
    state.lastShownAt = new Date().toISOString();
    await this.options.store.save(state);
  }
}

export function createTipEngine(options: TipEngineOptions): TipEngine {
  return new TipEngine(options);
}
