import type { GitHubTokenProvider } from "./app-auth.js";
import type { GitHubComment, ReplyTarget } from "./types.js";

/** Default GitHub REST API base URL (github.com). */
export const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";

/** Upper bound on pages fetched by one list call (100 items per page). */
const MAX_PAGES = 10;
const PER_PAGE = 100;

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Reaction contents GitHub accepts on comments. */
export type GitHubReactionContent =
  | "+1"
  | "-1"
  | "laugh"
  | "confused"
  | "heart"
  | "hooray"
  | "rocket"
  | "eyes";

/** Which comment a reaction goes on: an issue comment or a PR review comment. */
export interface GitHubCommentRef {
  kind: "issue" | "review";
  commentId: number;
}

/**
 * A failed GitHub API call.
 *
 * `retryAfterMs` is set on 403/429 responses that carry rate-limit headers
 * (`Retry-After`, or `X-RateLimit-Remaining: 0` with `X-RateLimit-Reset`).
 * The client does not wait or retry; the caller decides.
 */
export class GitHubApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly retryAfterMs?: number;

  constructor(init: {
    status: number;
    method: string;
    path: string;
    message: string;
    retryAfterMs?: number;
  }) {
    super(
      `GitHub ${init.method} ${init.path} failed: ${init.status} ${init.message}`,
    );
    this.name = "GitHubApiError";
    this.status = init.status;
    this.method = init.method;
    this.path = init.path;
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** Request headers for the GitHub REST API. */
export function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
    "User-Agent": "copilotkit-channels-github",
  };
}

function rateLimitRetryAfterMs(res: Response, now: () => number) {
  const isRateLimitStatus = res.status === 403 || res.status === 429;
  if (!isRateLimitStatus) return undefined;

  const retryAfter = Number(res.headers.get("retry-after") ?? Number.NaN);
  if (Number.isFinite(retryAfter)) return retryAfter * 1000;

  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = Number(res.headers.get("x-ratelimit-reset") ?? Number.NaN);
  const isExhausted = remaining === "0" && Number.isFinite(reset);
  if (isExhausted) return Math.max(0, reset * 1000 - now());
  return undefined;
}

async function responseMessage(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const json: unknown = JSON.parse(text);
    const isObject = typeof json === "object" && json !== null;
    if (isObject && "message" in json && typeof json.message === "string") {
      return json.message;
    }
  } catch {
    // Not JSON: fall back to the raw body.
  }
  return text || res.statusText;
}

/** Map a non-2xx response to a {@link GitHubApiError}. */
export async function toGitHubApiError(
  res: Response,
  method: HttpMethod,
  url: string,
  now: () => number,
) {
  return new GitHubApiError({
    status: res.status,
    method,
    path: new URL(url).pathname,
    message: await responseMessage(res),
    retryAfterMs: rateLimitRetryAfterMs(res, now),
  });
}

function nextPageUrl(res: Response) {
  const link = res.headers.get("link");
  if (link === null) return null;
  const match = /<([^>]+)>;\s*rel="next"/.exec(link);
  return match?.[1] ?? null;
}

/** Options for {@link GitHubApiClient}. */
export interface GitHubApiClientOptions {
  /** Auth: GitHub App installation tokens, or a static token. */
  auth: GitHubTokenProvider;
  /** GitHub REST API base URL (default `"https://api.github.com"`). */
  apiBaseUrl?: string;
  /** `fetch` implementation (default `globalThis.fetch`). */
  fetch?: typeof fetch;
  /** Clock in milliseconds since the epoch, used for rate-limit math (default `Date.now`). */
  now?: () => number;
}

interface GitHubReaction {
  id: number;
}

interface GitHubAppInfo {
  slug: string;
}

interface GitHubAuthenticatedUser {
  login: string;
}

/**
 * Thin GitHub REST client for issue comments, PR review comments, and reactions.
 *
 * Every method throws a {@link GitHubApiError} on a non-2xx response.
 */
export class GitHubApiClient {
  private readonly auth: GitHubTokenProvider;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: GitHubApiClientOptions) {
    this.auth = options.auth;
    this.apiBaseUrl = options.apiBaseUrl ?? DEFAULT_GITHUB_API_BASE_URL;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  /** Post a comment on an issue or PR conversation. */
  async createIssueComment(target: ReplyTarget, body: string) {
    const url = `${this.repoUrl(target)}/issues/${target.issueNumber}/comments`;
    return this.json<GitHubComment>(target, "POST", url, { body });
  }

  /** Edit an issue or PR conversation comment. */
  async updateIssueComment(
    target: ReplyTarget,
    commentId: number,
    body: string,
  ) {
    const url = `${this.repoUrl(target)}/issues/comments/${commentId}`;
    return this.json<GitHubComment>(target, "PATCH", url, { body });
  }

  /** Delete an issue or PR conversation comment. */
  async deleteIssueComment(target: ReplyTarget, commentId: number) {
    const url = `${this.repoUrl(target)}/issues/comments/${commentId}`;
    await this.send(target, "DELETE", url);
  }

  /** Reply inside the PR review thread whose root comment is `rootCommentId`. */
  async replyToReviewComment(
    target: ReplyTarget,
    rootCommentId: number,
    body: string,
  ) {
    const url = `${this.repoUrl(target)}/pulls/${target.issueNumber}/comments/${rootCommentId}/replies`;
    return this.json<GitHubComment>(target, "POST", url, { body });
  }

  /** Edit a PR review comment. */
  async updateReviewComment(
    target: ReplyTarget,
    commentId: number,
    body: string,
  ) {
    const url = `${this.repoUrl(target)}/pulls/comments/${commentId}`;
    return this.json<GitHubComment>(target, "PATCH", url, { body });
  }

  /** Delete a PR review comment. */
  async deleteReviewComment(target: ReplyTarget, commentId: number) {
    const url = `${this.repoUrl(target)}/pulls/comments/${commentId}`;
    await this.send(target, "DELETE", url);
  }

  /** All conversation comments on an issue or PR, oldest first (up to 1000). */
  async listIssueComments(target: ReplyTarget) {
    const url = `${this.repoUrl(target)}/issues/${target.issueNumber}/comments?per_page=${PER_PAGE}`;
    return this.pages<GitHubComment>(target, url);
  }

  /**
   * One PR review thread: the root comment plus its replies, sorted by
   * `created_at`. Built from the PR's review comments (up to 1000).
   */
  async listReviewThread(target: ReplyTarget, rootCommentId: number) {
    const url = `${this.repoUrl(target)}/pulls/${target.issueNumber}/comments?per_page=${PER_PAGE}`;
    const comments = await this.pages<GitHubComment>(target, url);
    return comments
      .filter(
        (comment) =>
          comment.id === rootCommentId ||
          comment.in_reply_to_id === rootCommentId,
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /** Add a reaction to a comment. Returns the reaction id (for `removeReaction`). */
  async addReaction(
    target: ReplyTarget,
    ref: GitHubCommentRef,
    content: GitHubReactionContent,
  ) {
    const url = `${this.commentUrl(target, ref)}/reactions`;
    const reaction = await this.json<GitHubReaction>(target, "POST", url, {
      content,
    });
    return reaction.id;
  }

  /** Remove a reaction added by `addReaction`. */
  async removeReaction(
    target: ReplyTarget,
    ref: GitHubCommentRef,
    reactionId: number,
  ) {
    const url = `${this.commentUrl(target, ref)}/reactions/${reactionId}`;
    await this.send(target, "DELETE", url);
  }

  /**
   * The login the bot posts as. App mode reads `GET /app` and returns
   * `<slug>[bot]`. Token mode reads `GET /user` and returns its `login`.
   */
  async getAuthenticatedBotLogin() {
    switch (this.auth.kind) {
      case "app": {
        const url = `${this.apiBaseUrl}/app`;
        const res = await this.request("GET", url, this.auth.createJwt());
        const app = (await res.json()) as GitHubAppInfo;
        return `${app.slug}[bot]`;
      }
      case "token": {
        const url = `${this.apiBaseUrl}/user`;
        const res = await this.request("GET", url, await this.auth.getToken());
        const user = (await res.json()) as GitHubAuthenticatedUser;
        return user.login;
      }
    }
  }

  private repoUrl(target: ReplyTarget) {
    const owner = encodeURIComponent(target.owner);
    const repo = encodeURIComponent(target.repo);
    return `${this.apiBaseUrl}/repos/${owner}/${repo}`;
  }

  private commentUrl(target: ReplyTarget, ref: GitHubCommentRef) {
    const collection = ref.kind === "issue" ? "issues" : "pulls";
    return `${this.repoUrl(target)}/${collection}/comments/${ref.commentId}`;
  }

  private async request(
    method: HttpMethod,
    url: string,
    token: string,
    body?: object,
  ) {
    const headers =
      body === undefined
        ? githubHeaders(token)
        : { ...githubHeaders(token), "Content-Type": "application/json" };
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await toGitHubApiError(res, method, url, this.now);
    return res;
  }

  private async send(
    target: ReplyTarget,
    method: HttpMethod,
    url: string,
    body?: object,
  ) {
    const token = await this.auth.getToken(target.installationId);
    return this.request(method, url, token, body);
  }

  private async json<T>(
    target: ReplyTarget,
    method: HttpMethod,
    url: string,
    body?: object,
  ) {
    const res = await this.send(target, method, url, body);
    return (await res.json()) as T;
  }

  private async pages<T>(target: ReplyTarget, firstUrl: string) {
    const items: T[] = [];
    let url: string | null = firstUrl;
    for (let page = 0; page < MAX_PAGES && url !== null; page++) {
      const res: Response = await this.send(target, "GET", url);
      const batch = (await res.json()) as T[];
      items.push(...batch);
      url = nextPageUrl(res);
    }
    return items;
  }
}
