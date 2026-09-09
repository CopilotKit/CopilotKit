// The split-out chunk the entry re-exports. `zod` stands in for a forbidden dep
// in the tests (it is a real dependency of this package, so it resolves through
// node_modules exactly as shiki/streamdown would).
import { z } from "zod";

export const schema = z.string();
