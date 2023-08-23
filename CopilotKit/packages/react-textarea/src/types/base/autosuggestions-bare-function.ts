export type AutosuggestionsBareFunction = (
  textBefore: string,
  textAfter: string,
  abortSignal: AbortSignal
) => Promise<string>;
