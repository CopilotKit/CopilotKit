// Claude Code PreToolUse hook: block attempts to skip lefthook
const input = [];
process.stdin.on("data", (chunk) => input.push(chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(Buffer.concat(input).toString());
    const command = data.tool_input?.command || "";

    // Strip quoted strings and $(...) substitutions so we only check actual
    // flags, not text that happens to appear inside commit messages or heredocs.
    const stripped = command
      .replace(/\$\([\s\S]*?\)/g, "")
      .replace(/"[^"]*"/g, "")
      .replace(/'[^']*'/g, "");

    // Block git commit --no-verify / -n (skips pre-commit hooks)
    if (/git\s+commit/.test(stripped) && /(--no-verify|\s-n\s|-n$)/.test(stripped)) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason:
            "--no-verify is forbidden in this project. Lefthook pre-commit hooks must run. Remove --no-verify (or -n) and commit again.",
        })
      );
      return;
    }

    // Block LEFTHOOK=0 (another way to disable lefthook)
    if (/LEFTHOOK=0/.test(stripped)) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason:
            "LEFTHOOK=0 is forbidden. Lefthook pre-commit hooks must run. Remove LEFTHOOK=0 and try again.",
        })
      );
      return;
    }

    // Block --no-gpg-sign as well (per project conventions)
    if (/git\s+commit/.test(stripped) && /--no-gpg-sign/.test(stripped)) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason:
            "--no-gpg-sign is not allowed. Remove it and commit again.",
        })
      );
      return;
    }
  } catch {
    // JSON parse error — allow the command through
  }
});
