const META_INSTRUCTION = [
  'End your reply with a fenced code block labelled `triage-meta` containing JSON:',
  '```triage-meta',
  '{ "reproducible": <true|false>, "area": "<area or null>", "severity": "<low|medium|high|null>", "labels": ["bug", "area:...", "severity:..."] }',
  '```',
  'Pick labels only from: bug, needs-repro, not-reproducible, question, documentation, enhancement, and area:<name>, severity:<low|medium|high>.',
].join('\n')

export function triagePrompt(i: { title: string; body: string }) {
  return {
    system: 'You are CopilotKit\'s issue-triage engineer. Investigate READ-ONLY: read code, grep, run read-only commands. Never edit files. Follow the skills in /tmp/triage-skills (esp. debugging-discipline).',
    user: [
      `Triage this issue against the checked-out repo.`,
      `# Issue: ${i.title}`, i.body, '',
      'Report: (1) suspected root cause with file:line evidence, (2) whether it is reproducible and how, (3) if actionable, the concrete fix approach. Be concise and specific.',
      META_INSTRUCTION,
    ].join('\n'),
  }
}

export function fixPrompt(i: { title: string; body: string; number: number; priorComments: string }) {
  return {
    system: 'You are CopilotKit\'s issue-fix engineer. You may EDIT files to fix the issue. Follow repo conventions and the skills in /tmp/triage-skills. Do NOT run git or open a PR — just make the code changes and add/adjust tests. Keep the change minimal and focused.',
    user: [
      `Fix issue #${i.number} in the checked-out repo.`,
      `# Issue: ${i.title}`, i.body, '',
      i.priorComments ? `## Prior triage findings\n${i.priorComments}` : '(No prior triage comment — investigate first, then fix.)',
      '', 'Make the smallest correct change. Add a test that fails without your fix and passes with it, if the area is testable. Summarize what you changed and why.',
    ].join('\n'),
  }
}
