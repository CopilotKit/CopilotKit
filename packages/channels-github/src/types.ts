import type { StateStore } from "@copilotkit/channels-core";

/**
 * Where a reply goes: an issue or PR conversation, or one PR review thread.
 *
 * When `reviewCommentId` is set, the reply is posted inline in that PR review
 * thread. Otherwise it is posted as an issue comment on the issue or PR.
 */
export interface ReplyTarget {
  /** GitHub App installation that owns the repository. Absent in token (PAT) mode. */
  installationId?: number;
  /** Repository owner login (user or organization). */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Issue or pull request number. */
  issueNumber: number;
  /** Root comment id of a PR review thread. Set only when replying inline in that thread. */
  reviewCommentId?: number;
  /**
   * The comment that started the turn (an issue comment, or a review comment
   * when `reviewCommentId` is set). The run renderer puts an `eyes` reaction
   * on it while the agent writes. Set by ingress on turns only.
   */
  triggerCommentId?: number;
}

/** A GitHub comment ref: an issue comment or a PR review comment. */
export interface GitHubMessageRef {
  /** Comment id. */
  id: number;
  /** `"issue"` for an issue/PR conversation comment, `"review"` for a PR review comment. */
  kind: "issue" | "review";
  /** Repository owner login. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Issue or pull request number. */
  issueNumber: number;
  [k: string]: unknown;
}

/** Options shared by both auth modes. */
interface GitHubAdapterBaseOptions {
  /** Webhook secret used to validate `X-Hub-Signature-256` on inbound POSTs. */
  webhookSecret: string;
  /** Login the bot answers to (without `@`). A comment must mention `@botUsername` to start a turn. */
  botUsername: string;
  /**
   * Port for the built-in `node:http` webhook server. When omitted, no server
   * starts; mount `handleWebhook(request)` in your own HTTP framework instead.
   */
  port?: number;
  /** Webhook path for the built-in server (default `"/webhook"`). */
  path?: string;
  /** GitHub REST API base URL (default `"https://api.github.com"`). Set it for GitHub Enterprise Server. */
  apiBaseUrl?: string;
  /** `fetch` implementation for GitHub API calls (default `globalThis.fetch`). Overridable for tests. */
  fetch?: typeof fetch;
  /** Store for adapter state such as pending choices (default `MemoryStore`). */
  stateStore?: StateStore;
  /** Custom-event names treated as interrupts by the run renderer. */
  interruptEventNames?: ReadonlySet<string>;
}

/** GitHub App auth: the adapter signs an App JWT and mints a per-installation token. */
interface GitHubAppAuthOptions {
  /** GitHub App id. */
  appId: string | number;
  /** GitHub App private key, PEM encoded. */
  privateKey: string;
  token?: never;
}

/** Token auth for local development: a personal access token used for every call. */
interface GitHubTokenAuthOptions {
  /** Personal access token (classic or fine-grained). */
  token: string;
  appId?: never;
  privateKey?: never;
}

/**
 * Options for the GitHub adapter. Pass either GitHub App credentials
 * (`appId` + `privateKey`) or a `token` for local development.
 */
export type GitHubAdapterOptions = GitHubAdapterBaseOptions &
  (GitHubAppAuthOptions | GitHubTokenAuthOptions);

/** A GitHub user or bot account, as it appears in webhook payloads. */
export interface GitHubUser {
  login: string;
  id: number;
  /** `"User"`, `"Bot"`, or `"Organization"`. */
  type: string;
}

/** The repository object in a webhook payload. */
export interface GitHubRepository {
  name: string;
  owner: { login: string };
}

/** The installation object in a webhook payload (GitHub App deliveries only). */
export interface GitHubInstallation {
  id: number;
}

/** A comment as it appears in `issue_comment` and `pull_request_review_comment` payloads. */
export interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser;
  html_url: string;
  /** Parent review comment id. Present on replies inside a PR review thread. */
  in_reply_to_id?: number;
  created_at: string;
  /** Review comments only: the file the comment is on. */
  path?: string;
  /** Review comments only: the diff lines up to the commented line. */
  diff_hunk?: string;
  /** Review comments only: the commented line in the new file, or `null` when it is outdated. */
  line?: number | null;
  /** Review comments only: the commented line when the comment was made. */
  original_line?: number | null;
}

/** An issue or pull request, as `GET /repos/{owner}/{repo}/issues/{number}` returns it. */
export interface GitHubIssue {
  number: number;
  title: string;
  /** Markdown description. `null` when empty. */
  body: string | null;
  html_url: string;
  /** Present when the issue is a pull request. */
  pull_request?: { url?: string };
}

/** Fields shared by the comment webhook events the adapter reads. */
interface GitHubCommentEventBase {
  action: string;
  comment: GitHubComment;
  repository: GitHubRepository;
  installation?: GitHubInstallation;
  sender: GitHubUser;
}

/** `issue_comment` webhook payload. Fires for comments on issues and PRs. */
export interface IssueCommentEvent extends GitHubCommentEventBase {
  issue: {
    number: number;
    /** Present when the issue is a pull request. */
    pull_request?: { url?: string };
  };
}

/** `pull_request_review_comment` webhook payload. Fires for inline PR review comments. */
export interface PullRequestReviewCommentEvent extends GitHubCommentEventBase {
  pull_request: { number: number };
}
