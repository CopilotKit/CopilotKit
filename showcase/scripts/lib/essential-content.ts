export interface PageInput {
  path: string;
  body: string;
}

export type Status = "pass" | "fail";

export interface ContentResult {
  status: Status;
  messages: string[];
}

interface Rule {
  description: string;
  test: (body: string) => boolean;
}

const QUICKSTART_RULES: Rule[] = [
  {
    description: "install step (bash/npm/uv install)",
    test: (b) => /install|npm i\b|uv add|npx /i.test(b),
  },
  {
    description: "run agent step",
    test: (b) => /run.*(agent|server|dev)/i.test(b),
  },
  {
    description: "wire CopilotKit provider",
    test: (b) => /CopilotKit\s*(?:Provider)?|<CopilotKit\b/i.test(b),
  },
  {
    description: "try-it / first interaction",
    test: (b) => /try it|chat|ask the agent|start chatting/i.test(b),
  },
];

const FEATURE_RULES: Rule[] = [
  {
    description: "what-is intro",
    test: (b) => /what is this|what is\b|introduction/i.test(b),
  },
  {
    description: "at least one fenced code sample",
    test: (b) => /```[a-z]/i.test(b),
  },
  {
    description: "next-steps or further-reading link",
    test: (b) =>
      /next steps|what's next|further reading|see also/i.test(b) ||
      /<Card\b/i.test(b),
  },
];

function pickRules(pathRel: string): Rule[] {
  if (/quickstart/i.test(pathRel)) return QUICKSTART_RULES;
  if (/troubleshooting/i.test(pathRel)) return [];
  return FEATURE_RULES;
}

export function checkEssentialContent(input: PageInput): ContentResult {
  const rules = pickRules(input.path);
  const messages: string[] = [];
  for (const rule of rules) {
    if (!rule.test(input.body)) {
      messages.push(`${input.path}: missing ${rule.description}`);
    }
  }
  return {
    status: messages.length === 0 ? "pass" : "fail",
    messages,
  };
}
