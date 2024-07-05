import { copyQaSnippetsToMintlify } from "./lib/copy-qa-snippets-to-mintlify";
import { Documentation } from "./lib/doc";
import { getAnnotatedMdxDocs } from "./lib/mdx";
import { copyFileSync } from "fs";

const DOCS_PATH = "../docs";
const CSS_PATH = "packages/react-ui/dist/index.css";

copyQaSnippetsToMintlify();

getAnnotatedMdxDocs(DOCS_PATH)
  .then(async (annotations) => {
    for (const annotation of annotations) {
      const doc = new Documentation(annotation);
      await doc.generate();
    }
  })
  .then(async () => {
    // copy over the style.css file
    copyFileSync(CSS_PATH, "../docs/_snippets/style.css");
  })
  .catch((error) => {
    console.error("Error generating docs:", error);
  });
