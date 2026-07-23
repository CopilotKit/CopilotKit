let idCounter = 0;

export function uniqueId(prefix: string): string {
  idCounter += 1;
  return `cpk-a2ui-${prefix}-${idCounter}`;
}
