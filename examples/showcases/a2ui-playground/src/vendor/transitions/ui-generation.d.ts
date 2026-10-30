export type GenerateMode = "skeleton" | "skeleton-texts";
export type GenerateOptions = {
  mode?: GenerateMode;
  duration?: number;
  delay?: number;
  steps?: string[];
  done?: string;
  code?: string[] | null;
  title?: string | null;
  maxParts?: number;
  keys?: number;
  onDone?: ((el: HTMLElement) => void) | null;
};
export type GenerateRun = { finished: Promise<HTMLElement>; cancel: () => void; element: HTMLElement };
export function generate(el: HTMLElement | string, options?: GenerateOptions): GenerateRun;
export function auto(root?: ParentNode): void;
