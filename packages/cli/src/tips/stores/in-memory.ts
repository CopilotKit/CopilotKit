import { TipState, TipStore } from "../types.js";

export class InMemoryTipStore implements TipStore {
  private state: TipState = { shownTipIds: [] };

  async load(): Promise<TipState> {
    return { ...this.state, shownTipIds: [...this.state.shownTipIds] };
  }

  async save(state: TipState): Promise<void> {
    this.state = { ...state, shownTipIds: [...state.shownTipIds] };
  }
}
