// Scheduler entry: one fresh supervised attempt on both frameworks.
// Keep the three-attempt acceptance sequence as a separate manual mode.
if (
  process.argv
    .slice(2)
    .some((arg) => arg === "--mode" || arg.startsWith("--mode="))
)
  throw new Error(
    "one-run fixes mode=single; use controller.mjs for acceptance",
  );
process.argv.push("--mode=single");
await import("./controller.mjs");
