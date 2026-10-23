import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Original fixture bytes are independent evidence. Raw captured runs remain
 * untouched; resolvedBase64 augments only the source projection for references.
 * Missing/wrong-discriminator inputs become source findings, never exclusions.
 */
export async function prepareSourceMedia(source, files, scenarioId) {
  const originals = [],
    observed = [],
    observations = [];
  for (const [index, file] of files.entries()) {
    const bytes = await readFile(file.path);
    const original = {
      filename: basename(file.path),
      mime: file.mimeType,
      sha256: hash(bytes),
      byteLength: bytes.length,
      type: file.type,
      sourceType: file.sourceType,
    };
    const candidates = source.messages
      .flatMap((message, messageIndex) =>
        (Array.isArray(message.content) ? message.content : []).map(
          (part, partIndex) => ({ part, messageIndex, partIndex }),
        ),
      )
      .filter(
        ({ part }) =>
          part.type === file.type &&
          part.metadata?.filename === original.filename &&
          part.source?.type === file.sourceType,
      );
    originals.push(original);
    const candidate = candidates.length === 1 ? candidates[0] : null;
    let actual = { present: false, matches: candidates.length };
    if (candidate) {
      const { part } = candidate;
      if (part.source.type !== "data") {
        if (!file.sourceValue || part.source.value !== file.sourceValue)
          throw new Error(
            "Reference media requires the declared URL/provider-file ID to match framework input",
          );
        part.resolvedBase64 = bytes.toString("base64");
      }
      const reached = Buffer.from(
        part.source.type === "data" ? part.source.value : part.resolvedBase64,
        "base64url",
      );
      actual = {
        present: true,
        filename: part.metadata.filename,
        mime: part.source.mimeType,
        sha256: hash(reached),
        byteLength: reached.length,
        type: part.type,
        sourceType: part.source.type,
      };
    }
    observed.push(actual);
    observations.push({
      name: `${scenarioId}-${file.type}:${file.sourceType}-framework-source`,
      category: `${file.type}:${file.sourceType}`,
      record: "inspection",
      pointer: `/sourceMedia/${index}`,
      expected: { present: true, ...original },
      source: {
        artifact: `${scenarioId}-source.json`,
        pointer: `/mediaOriginals/${index}`,
      },
    });
  }
  source.mediaOriginals = originals;
  return { observed, observations };
}
