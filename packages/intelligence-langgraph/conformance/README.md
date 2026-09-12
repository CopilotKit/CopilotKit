# Learned skill delivery conformance, version 1

These JSON fixtures contain synthetic skills and virtual-clock scenarios. Each language adapter can use the same input and expected result. The fixtures test the learned-skill contract independently of Runtime socket tests.

`snapshots.v1.json` provides complete ZIP bytes in `archiveBase64`, the response revision and ETag, and an expected result. `valid` means validation succeeds. Any other expected value is a delivery error code. The ZIP bytes include stored files, deflated files, data descriptors, UTF-8 names, and invalid structures. Supporting binary resources remain part of verified membership but have no model-readable text.

`lifecycle.v1.json` starts each independent scenario at `initialTimeMs`. Each step advances the virtual clock by `advanceMs`, queues its optional registry reply, and acquires a snapshot. A reply refers to a named snapshot fixture, a matching unchanged result, or a typed error. The expected value gives the result or error, request count, and relevant status fields. Request-count assertions enforce freshness and the absence of hidden retries. Concurrent refreshes and native cancellation also have focused TypeScript tests.

## Ordering and names

Compare skill names and relative file paths by their UTF-8 bytes, in ascending lexicographic order. For valid Unicode strings, this is Unicode codepoint order. Do not apply locale collation, case folding, or Unicode normalization. The fixtures include U+E000 and U+10000 to distinguish this order from JavaScript's default UTF-16 order.

Archive names must decode as strict UTF-8 and retain their exact characters, including a leading BOM. Paths are relative and contain no empty component, dot component, parent component, backslash, control character, or Windows drive prefix. File paths remain relative to one skill directory. Explicit directory entries contain no bytes and do not add readable files. Every regular file must match manifest membership. Each skill has exactly one `SKILL.md`, which must decode as UTF-8.

## Internal corruption bounds

The adapter accepts at most 32 MiB of archive bytes, 32 MiB of total uncompressed entry bytes, and 1,000 archive entries. The entry count includes the manifest and explicit directories. The decoded byte total includes the manifest. These are internal validation bounds, not additional configuration options or server publication rules.

Each file must match its declared size and SHA-256 digest. The complete ZIP must match the strong quoted SHA-256 ETag. The manifest revision must match the response revision. Unknown numeric schema versions produce `UNSUPPORTED_SERVER`; malformed snapshots produce `INVALID_SNAPSHOT`. Additive manifest fields remain compatible.
