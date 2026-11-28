import type { Interrupt, RunAgentResult } from "@ag-ui/client";

export interface InterruptEvent<TValue = unknown> {
  name: string;
  value: TValue;
}

export type InterruptResolveFn = (
  payload?: unknown,
  interruptId?: string,
) => Promise<RunAgentResult | void>;

export type InterruptCancelFn = (
  interruptId?: string,
) => Promise<RunAgentResult | void>;

export interface InterruptHandlerProps<TValue = unknown> {
  event: InterruptEvent<TValue>;
  interrupt: Interrupt | null;
  interrupts: Interrupt[];
  resolve: InterruptResolveFn;
  cancel: InterruptCancelFn;
}

export interface InterruptRenderProps<TValue = unknown, TResult = unknown> {
  event: InterruptEvent<TValue>;
  interrupt: Interrupt | null;
  interrupts: Interrupt[];
  result: TResult;
  resolve: InterruptResolveFn;
  cancel: InterruptCancelFn;
}
