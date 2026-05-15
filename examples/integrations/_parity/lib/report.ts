export type Severity = "ok" | "warn" | "error";

export interface DriftItem {
  severity: Severity;
  instance: string;
  kind:
    | "verbatim-file"
    | "package-json"
    | "agent-tool"
    | "agent-state"
    | "prompt"
    | "missing-instance";
  subject: string;
  detail?: string;
  expected?: string;
  actual?: string;
}

export interface Report {
  instance: string;
  items: DriftItem[];
}

export function hasErrors(reports: Report[]): boolean {
  return reports.some((r) => r.items.some((i) => i.severity === "error"));
}

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const GRN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function color(enabled: boolean, code: string, s: string): string {
  return enabled ? `${code}${s}${RESET}` : s;
}

export function printReports(reports: Report[], useColor = true): void {
  for (const r of reports) {
    const errors = r.items.filter((i) => i.severity === "error");
    const warns = r.items.filter((i) => i.severity === "warn");
    const oks = r.items.filter((i) => i.severity === "ok");

    const header = color(
      useColor,
      BOLD,
      `\n${r.instance} — ${oks.length} ok, ${warns.length} warn, ${errors.length} error`,
    );
    process.stdout.write(header + "\n");

    for (const item of [...errors, ...warns]) {
      const tag =
        item.severity === "error"
          ? color(useColor, RED, "  ✗")
          : color(useColor, YEL, "  !");
      const kindStr = color(useColor, DIM, `[${item.kind}]`);
      process.stdout.write(`${tag} ${kindStr} ${item.subject}\n`);
      if (item.detail) process.stdout.write(`      ${item.detail}\n`);
      if (item.expected !== undefined || item.actual !== undefined) {
        if (item.expected !== undefined)
          process.stdout.write(`      expected: ${truncate(item.expected)}\n`);
        if (item.actual !== undefined)
          process.stdout.write(`      actual:   ${truncate(item.actual)}\n`);
      }
    }

    if (errors.length === 0 && warns.length === 0) {
      process.stdout.write(color(useColor, GRN, "  ✓ no drift\n"));
    }
  }
}

function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}
