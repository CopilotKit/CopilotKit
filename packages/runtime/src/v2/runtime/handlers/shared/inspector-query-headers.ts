/** Public numeric query-budget metadata; no upstream cookies or private headers. */
export function inspectorQueryHeaders(source: Headers): Headers {
  const headers = new Headers({ "Cache-Control": "no-store, private" });
  for (const name of [
    "x-query-cost",
    "x-query-budget-limit",
    "x-query-budget-remaining",
    "x-query-budget-reset",
    "retry-after",
  ]) {
    const value = source.get(name);
    if (value !== null && /^(0|[1-9]\d{0,9})$/.test(value))
      headers.set(name, value);
  }
  return headers;
}
