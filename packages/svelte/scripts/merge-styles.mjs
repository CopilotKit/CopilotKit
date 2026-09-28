import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const [outputFile, componentFile] = process.argv.slice(2);

if (!outputFile || !componentFile) {
  throw new Error(
    "Usage: node scripts/merge-styles.mjs <output-css> <component-css>",
  );
}

if (!existsSync(componentFile)) {
  throw new Error(`Component stylesheet not found: ${componentFile}`);
}

const globalStyles = readFileSync(outputFile, "utf8");
const componentStyles = readFileSync(componentFile, "utf8");

writeFileSync(outputFile, `${globalStyles}\n${componentStyles}`);
rmSync(componentFile);
