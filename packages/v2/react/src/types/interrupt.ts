export interface InterruptEvent<TValue = unknown> {
  name: string;
  value: TValue;
}

export interface InterruptHandlerProps<TValue = unknown> {
  event: InterruptEvent<TValue>;
  resolve: (response: unknown) => void;
}

export interface InterruptRenderProps<TValue = unknown> {
  event: InterruptEvent<TValue>;
  result: unknown;
  resolve: (response: unknown) => void;
}
