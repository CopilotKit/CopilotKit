const path = require("path");
const fs = require("fs");

const DOCS_SNIPPETS_DIR = path.join(__dirname, "../../../../docs/snippets/code-snippets");
const QA_SCRIPTS_DIR = path.join(__dirname, "../../qa/lib");

function prepare() {
  if (fs.existsSync(DOCS_SNIPPETS_DIR)) {
    console.log("Cleaning up existing snippets...");
    fs.rmSync(DOCS_SNIPPETS_DIR, { recursive: true });
  }
}

function parseJSDocProperty({ jsDoc, property }: { jsDoc: string; property: string }) {
  const propertyRegex = new RegExp(`@${property}\\s+(.*)`);
  const propertyMatch = jsDoc.match(propertyRegex);
  const propertyValue = propertyMatch ? propertyMatch[1] : "";
  return propertyValue;
}

// Copy files
function processFilesRecursively(directory: string) {
  const files = fs.readdirSync(directory, { withFileTypes: true });

  files.forEach((file: any) => {
    const fullPath = path.join(directory, file.name);

    if (file.isDirectory()) {
      processFilesRecursively(fullPath);
    } else {
      const relativeFilePathWithoutExtension = path
        .relative(QA_SCRIPTS_DIR, fullPath)
        .replace(path.extname(fullPath), "");
      const fileExtension = path.extname(file.name).slice(1);
      const targetPath = path.join(DOCS_SNIPPETS_DIR, `${relativeFilePathWithoutExtension}.mdx`);
      const fullFileContent = fs.readFileSync(fullPath, "utf8");

      // Extract the JSDoc comments
      const jsDocRegex = /\/\*\*[\s\S]*?\*\//;
      const jsDocMatch = fullFileContent.match(jsDocRegex);
      const jsDoc = jsDocMatch ? jsDocMatch[0] : "";

      // Remove JSDoc comments and get the file content
      const cleanFileContent = fullFileContent.replace(jsDocRegex, "");

      // Produce .MDX file
      const finalContent = `
\`\`\`${fileExtension} ${jsDoc && parseJSDocProperty({ jsDoc, property: "filePath" })}
${cleanFileContent.trim()}
\`\`\`
      `;

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, finalContent);

      console.log("Successfully copied file to ", targetPath);
    }
  });
}

export function copyQaSnippetsToMintlify() {
  console.log("Copying QA snippets to Mintlify...");
  prepare();
  processFilesRecursively(QA_SCRIPTS_DIR);
  console.log("Done!");
}
