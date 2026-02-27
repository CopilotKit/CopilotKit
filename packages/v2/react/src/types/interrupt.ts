export interface InterruptEvent<TValue = unknown> {
  name: string;
  value: TValue;
}

export interface InterruptHandlerProps<TValue = unknown> {
  event: InterruptEvent<TValue>;
  resolve: (response: unknown) => void;
}

export interface InterruptRenderProps<TValue = unknown, TResult = unknown> {
  event: InterruptEvent<TValue>;
  result: TResult;
  resolve: (response: unknown) => void;
}
