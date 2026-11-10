import type { StateStore } from "@copilotkit/channels-core";
import { GmailApiError } from "./gmail-api.js";
import type { GmailClient, GmailMessage } from "./gmail-api.js";
import { parseGmailMessage } from "./parse.js";
import type { ParsedEmail } from "./parse.js";

/** Mail with one of these labels is never answered. */
const SKIP_LABELS = ["SENT", "DRAFT", "SPAM", "TRASH"];
/** How long a processed message id is remembered. Gmail history ids last about a week. */
const SEEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface GmailSyncOptions {
  client: GmailClient;
  store: StateStore;
  labelId: string;
  /** The authenticated mailbox address, lower case. Namespaces store keys. */
  mailbox: () => string;
  /** True for the bot's own addresses. Mail from them is skipped. */
  isOwnAddress: (address: string) => boolean;
  /** Called once for each new email to answer, in mailbox order. */
  onEmail: (email: ParsedEmail, message: GmailMessage) => void;
}

function newer(a: string, b: string | undefined): boolean {
  return b === undefined || BigInt(a) > BigInt(b);
}

/**
 * Reads new mail with `users.history.list` from a stored cursor.
 *
 * One sync runs at a time per adapter. Every new message in the intake label
 * is handled, not just the newest. A message id is recorded in the store
 * before it is handed on, so a second notification for the same change (or a
 * second process sharing the store) does not answer it twice.
 */
export class GmailSync {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly opts: GmailSyncOptions) {}

  private get cursorKey(): string {
    return `channels-gmail:${this.opts.mailbox()}:${this.opts.labelId}:cursor`;
  }

  /** The stored history id, when there is one. */
  cursor(): Promise<string | undefined> {
    return this.opts.store.kv.get<string>(this.cursorKey);
  }

  /** Store `historyId` as the cursor when there is none yet. */
  async init(historyId: string): Promise<void> {
    if ((await this.cursor()) === undefined) {
      await this.opts.store.kv.set(this.cursorKey, historyId);
    }
  }

  /**
   * Read every change since the cursor and hand on each new email. Calls run
   * one after another. `hintHistoryId` is the history id from the push
   * notification; it is the fallback cursor when the stored one is missing or
   * too old.
   */
  sync(hintHistoryId?: string): Promise<void> {
    const run = this.chain.then(() => this.run(hintHistoryId));
    this.chain = run.catch(() => {});
    return run;
  }

  private async run(hint?: string): Promise<void> {
    const start = await this.cursor();
    if (start === undefined) {
      // No cursor: nothing to read from. Start from this notification.
      if (hint) await this.opts.store.kv.set(this.cursorKey, hint);
      return;
    }
    const ids: string[] = [];
    const seenIds = new Set<string>();
    let latest = start;
    let pageToken: string | undefined;
    const pages = new Set<string>();
    do {
      let page;
      try {
        page = await this.opts.client.listHistory({
          startHistoryId: start,
          labelId: this.opts.labelId,
          ...(pageToken ? { pageToken } : {}),
        });
      } catch (err) {
        if (err instanceof GmailApiError && err.status === 404) {
          // The cursor is too old for Gmail. Mail in the gap is not answered.
          const reset = hint ?? (await this.opts.client.getProfile()).historyId;
          console.warn(
            `[channels-gmail] history ${start} is no longer available; continuing from ${reset}`,
          );
          await this.opts.store.kv.set(this.cursorKey, reset);
          return;
        }
        throw err;
      }
      for (const record of page.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          const id = added.message.id;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            ids.push(id);
          }
        }
      }
      if (newer(page.historyId, latest)) latest = page.historyId;
      pageToken = page.nextPageToken;
      if (pageToken) {
        if (pages.has(pageToken))
          throw new Error("Gmail repeated a history page");
        pages.add(pageToken);
      }
    } while (pageToken);

    for (const id of ids) await this.handle(id);
    // Another sync may have moved the cursor further. Never move it back.
    const current = await this.cursor();
    if (newer(latest, current)) {
      await this.opts.store.kv.set(this.cursorKey, latest);
    }
  }

  private async handle(id: string): Promise<void> {
    let message: GmailMessage;
    try {
      message = await this.opts.client.getMessage(id);
    } catch (err) {
      // Deleted between the notification and now.
      if (err instanceof GmailApiError && err.status === 404) return;
      throw err;
    }
    const labels = message.labelIds ?? [];
    if (!labels.includes(this.opts.labelId)) return;
    if (SKIP_LABELS.some((l) => labels.includes(l))) return;
    const email = parseGmailMessage(message);
    if (!email.fromAddress || this.opts.isOwnAddress(email.fromAddress)) return;
    if (email.automatic) return;
    const seenKey = `channels-gmail:${this.opts.mailbox()}:msg:${id}`;
    if (await this.opts.store.dedup.seen(seenKey, SEEN_TTL_MS)) return;
    this.opts.onEmail(email, message);
  }
}
