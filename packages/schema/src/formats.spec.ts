import { expect, test } from "vitest";
import {
  base64,
  creditCard,
  cuid2,
  decimal,
  digits,
  domain,
  emoji,
  hexColor,
  hexadecimal,
  ip,
  ipv4,
  ipv6,
  isoDate,
  isoDateTime,
  isoTime,
  isoTimestamp,
  isoWeek,
  mac,
  nanoid,
  number,
  octal,
  schema as defineSchema,
  rfcEmail,
  safeInteger,
  safeParse,
  slug,
  string,
  ulid,
  uuid,
} from "./index.js";

test.each([
  ["base64", base64(), "aGVsbG8=", "not base64!"],
  ["cuid2", cuid2(), "tz4a98xxat96iws9zmbrgj3a", "A"],
  ["decimal", decimal(), "-12.50", "1e3"],
  ["digits", digits(), "12345", "12a"],
  ["domain", domain(), "example.com", "localhost"],
  ["emoji", emoji(), "😀", "Ada"],
  ["hex color", hexColor(), "#a1B2c3", "#xyz"],
  ["hexadecimal", hexadecimal(), "deadBEEF", "0xnope"],
  ["IPv4", ipv4(), "192.168.1.1", "999.1.1.1"],
  ["IPv6", ipv6(), "2001:db8::1", "2001:::1"],
  ["IP", ip(), "192.168.1.1", "999.1.1.1"],
  ["ISO date-time", isoDateTime(), "2024-01-02T03:04:05Z", "today"],
  ["ISO time", isoTime(), "03:04:05", "25:00:00"],
  ["ISO timestamp", isoTimestamp(), "2024-01-02T03:04:05Z", "today"],
  ["ISO week", isoWeek(), "2024-W01", "2024-W54"],
  ["MAC", mac(), "00:1A:2B:3C:4D:5E", "00:1A:2B"],
  ["Nano ID", nanoid(), "V1StGXR8_Z5jdHi6B-myT", "short"],
  ["octal", octal(), "755", "898"],
  ["RFC email", rfcEmail(), "ada@example.com", "ada@localhost"],
  ["slug", slug(), "ada-lovelace", "Ada Lovelace"],
  ["ULID", ulid(), "01ARZ3NDEKTSV4RRFFQ69G5FAV", "bad"],
] as const)(
  "%s accepts a valid value and rejects an invalid value",
  (_name, action, valid, invalid) => {
    const schema = defineSchema(string(), action);

    expect(safeParse(schema, valid).success).toBe(true);
    expect(safeParse(schema, invalid).success).toBe(false);
  },
);

test("creditCard applies a Luhn checksum", () => {
  const schema = defineSchema(string(), creditCard());

  expect(safeParse(schema, "4111111111111111").success).toBe(true);
  expect(safeParse(schema, "4111111111111112").success).toBe(false);
});

test("safeInteger rejects unsafe integer values", () => {
  const schema = defineSchema(number(), safeInteger());

  expect(safeParse(schema, 42).success).toBe(true);
  expect(safeParse(schema, Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
});

test("uuid accepts RFC 9562 Nil and Max UUID values", () => {
  const schema = defineSchema(string(), uuid());

  expect(
    safeParse(schema, "00000000-0000-0000-0000-000000000000").success,
  ).toBe(true);
  expect(
    safeParse(schema, "ffffffff-ffff-ffff-ffff-ffffffffffff").success,
  ).toBe(true);
});

test("isoDate validates years below 100 without the Date.UTC offset", () => {
  const schema = defineSchema(string(), isoDate());

  expect(safeParse(schema, "0099-01-02").success).toBe(true);
  expect(safeParse(schema, "0099-02-29").success).toBe(false);
});
