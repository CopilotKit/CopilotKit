import { z } from "zod";
import { def } from "./shared";

/** Text, Markdown and Image come from the Gen UI 2.0 standard catalog. */

export const contentDefinitions = {
  Heading: def(
    "Content",
    "Surface title with optional eyebrow and subtitle. Start most surfaces with one.",
    z.object({
      text: z.string(),
      eyebrow: z.string().optional(),
      subtitle: z.string().optional(),
      level: z.enum(["1", "2", "3"]).optional(),
    }),
  ),
  CodeBlock: def(
    "Content",
    "Syntax-colored code with language label and copy button. Use for any code, config, command or diff snippet.",
    z.object({
      code: z.string(),
      language: z.string().optional(),
      filename: z.string().optional(),
    }),
  ),
  Quote: def(
    "Content",
    "Pull quote with attribution: testimonial, review, reviewer comment.",
    z.object({
      text: z.string(),
      author: z.string().optional(),
      role: z.string().optional(),
    }),
  ),
  ImageGallery: def(
    "Content",
    "Grid of images with captions.",
    z.object({
      images: z.array(
        z.object({ url: z.string(), caption: z.string().optional() }),
      ),
      columns: z.number().optional(),
    }),
  ),
  VideoEmbed: def(
    "Content",
    "Embedded YouTube/Vimeo video by URL.",
    z.object({ url: z.string(), title: z.string().optional() }),
  ),
  Kbd: def(
    "Content",
    "Keyboard shortcut chips, e.g. keys ['Cmd','K'] with a label. Use for shortcuts and how-to steps.",
    z.object({ keys: z.array(z.string()), label: z.string().optional() }),
  ),
};
