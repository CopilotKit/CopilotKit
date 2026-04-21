// packages/cli/src/tips/types.ts

export interface Tip {
  id: string;
  message: string;
  category?: string;
  weight?: number;
}

export interface TipState {
  shownTipIds: string[];
  lastShownAt?: string;
}

export interface TipStrategy {
  select(tips: Tip[], state: TipState): Tip | null;
}

export interface TipRenderer {
  render(tip: Tip, log: (msg: string) => void): void;
}

export interface TipStore {
  load(): Promise<TipState>;
  save(state: TipState): Promise<void>;
}
