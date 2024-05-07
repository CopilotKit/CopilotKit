import { Documentation } from "./lib/doc";
import { getAnnotatedMdxDocs } from "./lib/mdx";

const DOCS_PATH = "../docs";

getAnnotatedMdxDocs(DOCS_PATH)
  .then(async (annotations) => {
    for (const annotation of annotations) {
      const doc = new Documentation(annotation);
      await doc.generate();
    }
  })
  .catch((error) => {
    console.error("Error generating docs:", error);
  });
