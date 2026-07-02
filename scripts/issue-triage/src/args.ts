export function parseCommand(
  body: string,
): { command: "triage" | "fix"; deep: boolean } | null {
  const first = body.trim().split("\n")[0].trim();
  const m = /^\/(triage|fix)\b(.*)$/.exec(first);
  if (!m) return null;
  return {
    command: m[1] as "triage" | "fix",
    deep: /(^|\s)--deep(\s|$)/.test(m[2]),
  };
}
