import { REDACTED } from "./types";

// Passwords and unambiguous credentials never leave the browser, even with full
// capture. Keys are split into lowercase words (`accessToken`, `access_token`,
// `Access-Token` all become "access token"). These match anywhere in the joined words:
const CREDENTIAL =
  /password|passwd|passphrase|passcode|credential|api(key|token)|privatekey|subscriptionkey|(access|refresh|auth|session)token|clientsecret/;
// These match only as whole words (`secret` but not `secretary`, `id token` but
// not `invalid token`), as the last word (`Set-Cookie` but not `cookieConsent`),
// or as the entire key.
const CREDENTIAL_WORD =
  / (secret|id ?token)s? | (authorization|cookies?|jwt|bearer ?token|[cx]srf ?token) $|^ (pwd|pass|token|otp) $/;
// Metadata about a credential is not the credential: `passwordExpiresAt`, `credentialId`.
const METADATA =
  / (ids?|at|in|expires?|expiry|length|count|enabled|required|policy|hint|type) $/;
const PASSWORD_AUTOCOMPLETE = /(current|new)-password|one-time-code/;
// A JSON string, possibly cut off, with the `:` that makes it a key.
const TOKEN = /"((?:\\[\s\S]|[^"\\])*)("?)(\s*:\s*)?/g;
// A lone trailing backslash belongs to a cut-off string.
const STRING = /"(?:\\[\s\S]?|[^"\\])*"?/y;
// `key=value` and `key: value` outside JSON strings: forms, query strings,
// GraphQL, YAML. A `:` needs a space or end after it, so `host:port` is no pair.
// The key length bound keeps scanning long unbroken text linear.
// An auth scheme (`Bearer x`) belongs to the value.
const PAIR =
  /([\w$.%+[\]-]{1,64})(\s*(?:=|:(?=\s|$))\s*)((?:(?:basic|bearer|digest|token) +)?[^\s&,;)}\]]*)/gi;
// `scheme://user:pass@` anywhere in text; up to the last `@` before the host.
// The scheme length bound keeps scanning long words linear.
const USERINFO = /([a-z][\w+.-]{0,31}:\/\/)[^\s/?#"]*@/gi;
/** Text beyond this is neither redacted nor kept; snapshots keep 4 KiB of the result. */
export const TEXT_LIMIT = 16 * 1024;
const REMEMBERED_VALUES = 20;

export const isCredentialKey = (key: string) => {
  const words = ` ${key
    .replace(/%([\da-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/([a-z\d])(?=[A-Z])/g, "$1 ")
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean)
    .join(" ")} `;
  return (
    !METADATA.test(words) &&
    (CREDENTIAL.test(words.replace(/ /g, "")) || CREDENTIAL_WORD.test(words))
  );
};

const decode = (body: string) => {
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    return body;
  }
};

/** The end of the JSON value at `start`: a string, a balanced object or array, or a bare literal. */
const endOfValue = (text: string, start: number) => {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      STRING.lastIndex = i;
      STRING.test(text);
      i = STRING.lastIndex - 1;
    } else if (char === "{" || char === "[") {
      depth++;
      continue;
    } else if (char === "}" || char === "]") {
      if (--depth < 0) return i;
    } else {
      if (!depth && (char === "," || /\s/.test(char))) return i;
      continue;
    }
    if (!depth) return i + 1;
  }
  return text.length;
};

/**
 * Redacts credential values in JSON (valid or cut off) and in key/value text,
 * and recurses into string values that hold JSON, forms, or URLs. Unchanged
 * parts keep their exact original text.
 */
const redactText = (text: string, depth = 0): string => {
  const token = new RegExp(TOKEN);
  let pending = false;
  const pairs = (part: string) => {
    const segment = part.replace(USERINFO, "$1");
    return segment.replace(
      PAIR,
      (pair, key: string, separator: string, value: string, offset: number) => {
        if (!isCredentialKey(key)) return pair;
        // The value may continue in a following string: `password:"x"`.
        if (offset + pair.length === segment.length) {
          pending = true;
          if (!value) return pair;
        }
        return key + separator + REDACTED;
      },
    );
  };
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text))) {
    const [raw, body, closed, colon] = match;
    pending = false;
    out += pairs(text.slice(last, match.index));
    let end = token.lastIndex;
    let replacement = raw;
    const value = body!.includes("\\") ? decode(body!) : body!;
    if (colon) {
      if (isCredentialKey(value)) {
        const valueEnd = endOfValue(text, end);
        // Booleans and null say whether a credential exists, not what it is.
        if (!/^(true|false|null|)$/.test(text.slice(end, valueEnd))) {
          replacement += `"${REDACTED}"`;
          end = valueEnd;
        }
      }
    } else if (pending) replacement = `"${REDACTED}"`;
    else if (depth < 4 && /[=:"]/.test(value)) {
      const redacted = redactText(value, depth + 1);
      if (redacted !== value)
        replacement = JSON.stringify(redacted).slice(
          0,
          closed ? undefined : -1,
        );
    }
    out += replacement;
    last = token.lastIndex = end;
  }
  return out + pairs(text.slice(last));
};

/** Per-session redaction state: password-like fields and the values typed into them. */
export function createRedactor() {
  const seen = new WeakSet<Element>();
  // Latest value per field, so each keystroke replaces the previous prefix.
  const remembered = new Map<Element, string>();
  let observer: MutationObserver | undefined;

  const toggled = (records: MutationRecord[]) => {
    for (const record of records)
      if (record.oldValue?.toLowerCase() === "password")
        seen.add(record.target as Element);
  };

  /** Replaces remembered values, raw and in their JSON and URL encodings. */
  const scrub = (text: string) => {
    for (const value of [...remembered.values()].sort(
      (a, b) => b.length - a.length,
    ))
      for (const form of [
        value,
        JSON.stringify(value).slice(1, -1),
        encodeURIComponent(value),
        new URLSearchParams({ v: value }).toString().slice(2),
      ])
        text = /^\d+$/.test(form)
          ? // One-time codes must not match inside longer numbers.
            text.replace(RegExp(`(?<!\\d)${form}(?!\\d)`, "g"), REDACTED)
          : text.split(form).join(REDACTED);
    return text;
  };

  /** True for current, former (show-password toggles), and autocomplete password fields. */
  const isPassword = (element: Element) => {
    if (observer) toggled(observer.takeRecords());
    if (
      !(element instanceof HTMLInputElement) ||
      !(
        element.type === "password" ||
        seen.has(element) ||
        isCredentialKey(element.name) ||
        PASSWORD_AUTOCOMPLETE.test(element.getAttribute("autocomplete") ?? "")
      )
    )
      return false;
    seen.add(element);
    if (element.value.length >= 4) {
      remembered.delete(element);
      remembered.set(element, element.value);
      if (remembered.size > REMEMBERED_VALUES)
        remembered.delete(remembered.keys().next().value!);
    }
    return true;
  };

  return {
    isPassword,
    /**
     * Tracks password fields for the session: existing ones, `type` toggles away
     * from "password", and typed values even when input capture is off.
     */
    watch() {
      // Each part is optional: a partial DOM (tests, embedded webviews, hardened
      // pages) must not stop capture from starting or break the host app.
      try {
        for (const input of document.querySelectorAll("input[type=password]"))
          seen.add(input);
      } catch {
        // Fields are still caught on first sight by isPassword.
      }
      let current: MutationObserver | undefined;
      try {
        current = new MutationObserver(toggled);
        current.observe(document, {
          subtree: true,
          attributeFilter: ["type"],
          attributeOldValue: true,
        });
        observer = current;
      } catch {
        current = undefined;
      }
      const remember = (event: Event) => {
        try {
          const [target] = event.composedPath();
          if (target instanceof Element) isPassword(target);
        } catch {
          // Capture must never break an edit in the host app.
        }
      };
      for (const type of ["input", "change"])
        window.addEventListener(type, remember, true);
      return () => {
        current?.disconnect();
        if (current !== undefined && observer === current) observer = undefined;
        for (const type of ["input", "change"])
          window.removeEventListener(type, remember, true);
      };
    },
    field: (key: string, value: string) =>
      isCredentialKey(key) ? REDACTED : scrub(redactText(value)),
    /** Returns the redacted body text, or undefined if redaction failed. */
    body(text: string) {
      try {
        return scrub(redactText(text.slice(0, TEXT_LIMIT)));
      } catch {
        return undefined;
      }
    },
    /** Drops userinfo and redacts credential values; also applied to element attributes. */
    url(value: string) {
      try {
        return scrub(value.replace(/[^#]+/g, (part) => redactText(part)));
      } catch {
        return REDACTED;
      }
    },
  };
}

export type Redactor = ReturnType<typeof createRedactor>;
