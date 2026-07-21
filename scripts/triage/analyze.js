// scripts/triage/analyze.js
// Shared issue-analysis used by triage-on-open + triage-backfill (single source of truth).
// Does ONE GitHub search + ONE combined Anthropic call; returns proposals only —
// no labels/comments are applied here (the caller applies per its policy).
// No npm deps: uses the passed `github` octokit + global fetch. Needs ANTHROPIC_API_KEY in env.

const MODEL = "claude-haiku-4-5-20251001";

async function ask(prompt, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || "{}";
  try {
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
  } catch {
    return {};
  }
}

// Cheap spam / low-signal gate — avoids spending an LLM call on obvious junk (cost guard).
function lowSignal(issue) {
  const labels = (issue.labels || []).map((l) => l.name || l);
  if (labels.some((n) => n === "spam" || n === "invalid"))
    return "already-flagged";
  const assoc = issue.author_association || "NONE";
  const outsider = assoc === "NONE" || assoc === "FIRST_TIMER";
  const bodyLen = (issue.body || "").replace(/\s/g, "").length;
  if (outsider && bodyLen < 15) return "empty-body-from-outsider";
  return null;
}

module.exports = async function analyzeIssue({
  github,
  owner,
  repo,
  issue,
  labelList,
}) {
  if (!process.env.ANTHROPIC_API_KEY) return { skipped: "no-api-key" };
  const skip = lowSignal(issue);
  if (skip) return { skipped: skip };

  // Candidate duplicates — lexical recall (upgrade to an embeddings index later if needed).
  const kw = (issue.title || "")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
  let candidates = [];
  try {
    const found = await github.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:issue ${kw}`,
      per_page: 12,
    });
    candidates = found.data.items
      .filter((i) => i.number !== issue.number && !i.pull_request)
      .slice(0, 8);
  } catch (_) {
    /* search rate-limited/failed — proceed label-only */
  }

  // ONE combined call: classification + dedup together.
  const candList = candidates.length
    ? candidates.map((c) => `#${c.number} [${c.state}]: ${c.title}`).join("\n")
    : "(none)";
  const out = await ask(
    [
      "Triage this GitHub issue. Do BOTH tasks and return a single JSON object.",
      "1) LABELS — choose best-fit labels from ONLY this list (canonical types: bug, feature request, question, documentation; plus a clear area label if one applies). Never invent labels; empty array if unsure.",
      labelList,
      "2) DUPLICATE — is the issue a duplicate of one candidate (same underlying problem, not merely similar area)?",
      `Candidates:\n${candList}`,
      "",
      `Title: ${issue.title}`,
      `Body:\n${(issue.body || "").slice(0, 4000)}`,
      "",
      'Respond with ONLY JSON: {"labels": string[], "labelConfidence": number 0-1, "duplicateOf": number|null, "dupConfidence": number 0-1}',
    ].join("\n"),
    400,
  );

  return {
    labels: Array.isArray(out.labels) ? out.labels : [],
    labelConfidence: Number(out.labelConfidence ?? 0),
    duplicateOf: typeof out.duplicateOf === "number" ? out.duplicateOf : null,
    dupConfidence: Number(out.dupConfidence ?? 0),
    candidates: candidates.map((c) => c.number),
  };
};
