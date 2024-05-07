import { promises as fs } from "fs";
import { join, resolve } from "path";
import { glob } from "glob";

type AnnotationType = "hook" | "component" | "class";

export interface AnnotatedDoc {
  path: string;
  comment: string;
  type: AnnotationType;
  name: string;
  sourcePath: string;
}

export async function getAnnotatedMdxDocs(directory: string): Promise<AnnotatedDoc[]> {
  const fullPath = resolve(directory);
  const pattern = join(fullPath, "**/*.mdx");
  const files = await glob(pattern);
  const annotations: AnnotatedDoc[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    // Regular expression to find the specific comment format
    const commentRegex = /{\/\*\s*GENERATE-DOCS\s*(.*?)\s*\*\/}/g;
    let match;
    while ((match = commentRegex.exec(content)) !== null) {
      const details = parseKeyValuePairs(match[1].trim());
      const sourcePath = details["path"];

      let type: AnnotationType | undefined;
      let name: string | undefined;

      for (const key of ["hook", "component", "class"]) {
        if (details[key]) {
          type = key as AnnotationType;
          name = details[key];
          break;
        }
      }

      if (type && name && sourcePath) {
        const annotatedDoc: AnnotatedDoc = {
          path: file,
          comment: match[1].trim(),
          type,
          name,
          sourcePath,
        };
        annotations.push(annotatedDoc);
      }
    }
  }

  return annotations;
}

function parseKeyValuePairs(input: string): Record<string, string> {
  return input.split(/\s+/).reduce(
    (acc, current) => {
      const [key, value] = current.split("=");
      if (key && value) {
        acc[key] = value.replace(/^['"]|['"]$/g, ""); // Remove quotes around the value
      }
      return acc;
    },
    {} as Record<string, string>,
  );
}
