import type { ContextEntry } from "@copilotkit/channels-core";

/** Tell the model it is on GitHub and which Markdown renders there. */
export const gitHubFormattingContext: ContextEntry = {
  description: "GitHub comment formatting rules",
  value:
    "You are replying in a GitHub issue, pull request, or pull request review " +
    "thread. Your reply is a GitHub comment in GitHub-flavored Markdown: " +
    "headings, **bold**, tables, task lists (- [ ] item), fenced code blocks " +
    "with a language (```ts), links, and collapsible <details><summary>…</summary></details> " +
    "sections all render. Put long logs or diffs in a <details> block. " +
    "Mention a user with @login. Reference an issue or PR with #number.",
};

/** How GitHub replies are delivered and how choices are answered. */
export const gitHubDeliveryContext: ContextEntry = {
  description: "GitHub comment delivery constraints",
  value:
    "Your reply streams into one comment that is edited as you write. A very " +
    "long reply continues in a new comment. When you offer choices, they show " +
    "as a numbered list, and the user answers by replying with a number. " +
    "Other comments reach you only when they mention the bot or answer an " +
    "open numbered choice.",
};

/** The context entries the GitHub adapter adds to every run by default. */
export const defaultGitHubContext: ContextEntry[] = [
  gitHubFormattingContext,
  gitHubDeliveryContext,
];
