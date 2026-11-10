/**
 * Email threading and header helpers.
 *
 * Every value that ends up in an outbound header passes through one of the
 * sanitizers here, so a crafted inbound subject or Message-ID cannot add
 * headers (CR/LF injection) to a reply.
 */

/** A parsed mailbox: `Name <address>` or a bare address. */
export interface Mailbox {
  address: string;
  name?: string;
}

/** A conservative address check: one `@`, no whitespace, no header syntax. */
const ADDRESS_RE = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+$/;

/** One Message-ID token: `<...>` with no whitespace or nested brackets. */
const MESSAGE_ID_RE = /<[^<>\s]+>/g;

/** Remove CR, LF and other control characters, then collapse whitespace. */
export function headerSafe(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** True when `value` is a plain email address safe to put in a header. */
export function isAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

/**
 * Parse `Name <a@b.c>`, `"Name" <a@b.c>`, or `a@b.c`. Returns `undefined`
 * when the input holds no safe address.
 */
export function parseMailbox(
  input: string | null | undefined,
): Mailbox | undefined {
  if (!input) return undefined;
  const value = headerSafe(input);
  const angle = value.match(/^(.*?)<([^<>]+)>\s*$/);
  if (angle) {
    const address = angle[2]!.trim();
    if (!isAddress(address)) return undefined;
    const name = angle[1]!
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .trim();
    return name ? { address, name } : { address };
  }
  return isAddress(value) ? { address: value } : undefined;
}

/** Format a mailbox for a header. The name is quoted; quotes and backslashes in it are removed. */
export function formatMailbox(mailbox: Mailbox): string {
  const name = mailbox.name
    ? headerSafe(mailbox.name).replace(/["\\]/g, "")
    : "";
  return name ? `"${name}" <${mailbox.address}>` : mailbox.address;
}

/** Lower-case an address for comparison. */
export function addressKey(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Extract the Message-IDs from a header value (`In-Reply-To`, `References`),
 * in order, without duplicates. Values that are not `<...>` tokens are
 * dropped, so the result is safe to put back into a header.
 */
export function parseMessageIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(" ") : value;
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw.match(MESSAGE_ID_RE) ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** A single Message-ID, normalized to `<...>`, or `undefined` when it is not one. */
export function normalizeMessageId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const wrapped = trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
  return /^<[^<>\s]+>$/.test(wrapped) ? wrapped : undefined;
}

/** The longest References header the adapter sends, in ids. Keeps the root and the newest ones. */
export const MAX_REFERENCES = 20;

/** Bound a References list: keep the root and the newest ids. */
export function trimReferences(ids: readonly string[]): string[] {
  if (ids.length <= MAX_REFERENCES) return [...ids];
  return [ids[0]!, ...ids.slice(ids.length - (MAX_REFERENCES - 1))];
}

/** The threading facts of one inbound email. */
export interface ThreadHeaders {
  messageId?: string;
  inReplyTo: string[];
  references: string[];
}

/**
 * The candidate root of a thread, without any stored mappings: the first
 * `References` id, else the first `In-Reply-To` id, else the email's own
 * Message-ID.
 */
export function threadRoot(headers: ThreadHeaders): string | undefined {
  return headers.references[0] ?? headers.inReplyTo[0] ?? headers.messageId;
}

/** Ids an inbound email points back to, newest first. Used to find a known thread. */
export function ancestorIds(headers: ThreadHeaders): string[] {
  const ids = [...headers.inReplyTo, ...headers.references.toReversed()];
  return [...new Set(ids)];
}

/** Build the conversation key for a thread root Message-ID. */
export function conversationKeyFor(rootMessageId: string): string {
  return `resend:${rootMessageId.replace(/^<|>$/g, "")}`;
}

/** The headers that put a reply in the same thread as `parent`. */
export function replyHeaders(
  parentMessageId: string | undefined,
  parentReferences: readonly string[],
): { inReplyTo?: string; references: string[] } {
  if (!parentMessageId) return { references: trimReferences(parentReferences) };
  const references = parentReferences.includes(parentMessageId)
    ? [...parentReferences]
    : [...parentReferences, parentMessageId];
  return { inReplyTo: parentMessageId, references: trimReferences(references) };
}

/** `Re: <subject>`, without stacking prefixes. Header-safe and bounded. */
export function replySubject(subject: string | null | undefined): string {
  const clean = headerSafe(subject ?? "").slice(0, 900);
  if (!clean) return "Re: (no subject)";
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}
