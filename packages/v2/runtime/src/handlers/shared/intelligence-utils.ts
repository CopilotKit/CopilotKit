export function isPlatformNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(" 404:");
}
