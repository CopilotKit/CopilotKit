export type SystemMessageFunction = (
  contextString: string,
  additionalInstructions?: string,
) => string;
