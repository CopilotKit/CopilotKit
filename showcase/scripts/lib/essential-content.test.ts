import { describe, it, expect } from "vitest";
import { checkEssentialContent } from "./essential-content.js";

describe("checkEssentialContent", () => {
  it("flags a quickstart page missing the 'run agent' section", () => {
    const result = checkEssentialContent({
      path: "integrations/mastra/quickstart.mdx",
      body: "# QS\n\nInstall the CLI.\n",
    });
    expect(result.status).toBe("fail");
    expect(result.messages.join(" ").toLowerCase()).toContain("run");
  });

  it("passes a quickstart page with all required elements", () => {
    const body = `# QS
## Install
\`\`\`bash
npm install
\`\`\`
## Run your agent
## Wire CopilotKit provider
## Try it
`;
    const result = checkEssentialContent({
      path: "integrations/mastra/quickstart.mdx",
      body,
    });
    expect(result.status).toBe("pass");
  });

  it("uses the feature-page checklist for non-quickstart pages", () => {
    const body = "# Frontend Tools\n\nWhat is this? Something.\n";
    const result = checkEssentialContent({
      path: "integrations/mastra/frontend-tools.mdx",
      body,
    });
    expect(result.status).toBe("fail");
    expect(result.messages.join(" ").toLowerCase()).toContain("code sample");
  });
});
