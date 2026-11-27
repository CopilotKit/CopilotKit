// A control that lists frontends must be able to act on every one it lists.
// `setFrontend` (shell-docs src/proto/frontend.tsx) and the stack store's
// `setStack` only set the reader's docs stack: an early-access frontend
// (iMessage, WhatsApp, SMS, RCS) has no docs, so they ignore it, and a pick
// of one would close the control and do nothing. So a control that only sets
// the docs stack lists `DOCS_FRONTENDS`; a control that lists every frontend
// (`FRONTENDS`) opens the pick through the shared `usePickFrontend()`.
//
// This scans shell-docs' source, one top-level function at a time, and then
// one file at a time.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../../../shell-docs/src");

/** Every .tsx file under src. */
function sources(dir = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** The full frontend list. `DOCS_FRONTENDS` and `APP_FRONTENDS` don't match. */
const ALL_FRONTENDS = /\bFRONTENDS\b/;
/** Sets only the reader's docs stack, which ignores an early-access frontend. */
const DOCS_ONLY_SETTER = /\bset(Frontend|Stack)\(/;
/** The shared pick handler, which opens the pick. */
const PICKS = /\bpickFrontend\(|\busePickFrontend\(/;
/** Opens a page: the pick handler, or a menu that navigates itself. */
const NAVIGATES = /\brouter\.push\(|\bpickFrontend\(|\busePickFrontend\(/;

interface Chunk {
  file: string;
  name: string;
  text: string;
}

/** A file's top-level functions and components, by the names they declare. */
function chunks(file: string): Chunk[] {
  const text = fs.readFileSync(file, "utf8");
  const starts = [
    ...text.matchAll(
      /^(?:export )?(?:async )?(?:function (\w+)|const (\w+) =)/gm,
    ),
  ];
  return starts.map((m, i) => ({
    file: path.relative(SRC, file),
    name: m[1] ?? m[2],
    text: text.slice(m.index, starts[i + 1]?.index ?? text.length),
  }));
}

const FILES = sources();
const CHUNKS = FILES.flatMap(chunks);

describe("a control that lists frontends", () => {
  test("acts on every frontend it lists", () => {
    const ignoring = CHUNKS.filter(
      (c) =>
        ALL_FRONTENDS.test(c.text) &&
        DOCS_ONLY_SETTER.test(c.text) &&
        // A router.push elsewhere in the control (TwoQuestions' framework
        // links) doesn't open a frontend pick, so only the handler counts.
        !PICKS.test(c.text),
    ).map((c) => `${c.file}: ${c.name}`);
    expect(ignoring).toEqual([]);
  });

  // A menu can list the frontends and hand the pick to its parent in the
  // same file (src/components/stack/stack-select.tsx): then the file as a
  // whole sets only the docs stack. A file that navigates (the home's
  // quickstart menu, which opens the pick with its own event) passes.
  test("hands its pick to a setter that acts on it", () => {
    const ignoring = FILES.filter((file) => {
      const text = fs.readFileSync(file, "utf8");
      return (
        ALL_FRONTENDS.test(text) &&
        DOCS_ONLY_SETTER.test(text) &&
        !NAVIGATES.test(text)
      );
    }).map((file) => path.relative(SRC, file));
    expect(ignoring).toEqual([]);
  });

  test("the scan sees the controls that set the docs stack", () => {
    const setters = CHUNKS.filter((c) => DOCS_ONLY_SETTER.test(c.text)).map(
      (c) => `${c.file}: ${c.name}`,
    );
    for (const control of [
      "proto/pieces.tsx: FrontendMenu",
      "proto/pieces.tsx: FrontendChips",
      "proto/pieces.tsx: PlainSentence",
      "proto/pieces.tsx: TwoQuestions",
      "proto/pieces.tsx: usePickFrontend",
      "components/stack/stack-select.tsx: StackSelect",
    ]) {
      expect(setters).toContain(control);
    }
  });
});
