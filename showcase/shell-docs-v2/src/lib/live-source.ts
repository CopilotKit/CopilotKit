import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { defineDocs } from "fumadocs-mdx/macro";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";

// The live docs, ported from shell-docs (`npm run sync-content`). Kept apart
// from `source.ts` so routes that only need the /docs pages don't compile
// all ~900 live pages. MDX options are global, in `source.config.ts`.

/**
 * shell-docs' meta.json allows an inline group in `pages`
 * (`{ title, pages, defaultOpen }`), which Fumadocs' schema doesn't. A group
 * becomes its pages between two marker separators, which `live-nav.ts` folds
 * back into a folder.
 */
export const GROUP_OPEN = "{group}";
export const GROUP_OPEN_EXPANDED = "{group:open}";
export const GROUP_CLOSE = "{/group}";

const liveMetaSchema = metaSchema.extend({
  pages: z
    .array(
      z.union([
        z.string(),
        z
          .object({
            title: z.string(),
            pages: z.array(z.string()),
            defaultOpen: z.boolean().optional(),
          })
          .loose(),
      ]),
    )
    .optional()
    .transform((pages) =>
      pages?.flatMap((p) =>
        typeof p === "string"
          ? [p]
          : [
              `---${p.defaultOpen ? GROUP_OPEN_EXPANDED : GROUP_OPEN}${p.title}---`,
              ...p.pages,
              `---${GROUP_CLOSE}---`,
            ],
      ),
    ),
});

/** shell-docs' frontmatter: Fumadocs' fields plus its own (kept as-is). */
const livePageSchema = pageSchema
  .extend({
    nav_title: z.string().optional(),
    hideTOC: z.boolean().optional(),
    hideHeader: z.boolean().optional(),
    hidePageActions: z.boolean().optional(),
    agentPrompt: z.string().optional(),
  })
  .loose();

const liveDocs = defineDocs({
  dir: "content/live/docs",
  docs: {
    schema: livePageSchema,
    async: true,
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: liveMetaSchema },
});

const liveReference = defineDocs({
  dir: "content/live/reference",
  docs: {
    schema: livePageSchema,
    async: true,
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: liveMetaSchema },
});

/**
 * Pages keep their docs.copilotkit.ai URLs: `docs/frontend-tools.mdx` is
 * `/frontend-tools`. Framework-scoped URLs (`/mastra/frontend-tools`) resolve
 * through `src/lib/live-docs.ts`.
 */
const liveFiles = liveDocs.toFumadocsSource();

export const liveSource = loader({
  baseUrl: "/",
  source: liveFiles,
  plugins: [lucideIconsPlugin()],
});

/**
 * One framework's own docs (`docs/integrations/<folder>`), rooted at its
 * meta.json, for its sidebar. Pages still resolve through `liveSource`.
 */
export function integrationSource(folder: string) {
  const prefix = `integrations/${folder}/`;
  return loader({
    baseUrl: `/integrations/${folder}`,
    source: {
      files: liveFiles.files
        .filter((f) => f.path.startsWith(prefix))
        .map((f) => ({ ...f, path: f.path.slice(prefix.length) })),
    },
  });
}

/** `reference/hooks/use-agent.mdx` is `/reference/v2/hooks/use-agent`. */
export const referenceSource = loader({
  baseUrl: "/reference",
  source: liveReference.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});
