interface LogUserErrorOptions {
  error: any;
  message: string;
  suggestion: string;
}

export function logUserError({ error, message, suggestion }: LogUserErrorOptions) {
  console.error(message);
  console.error("************************************************");
  console.error(error);
  console.error("************************************************");
  console.error(suggestion);
}

export function logUserErrorAndThrow(options: LogUserErrorOptions) {
  logUserError(options);
  throw options.error;
}
