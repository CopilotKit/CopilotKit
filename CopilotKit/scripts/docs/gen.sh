#!/bin/sh
set -e

# Set base directory
BASE_DIR="../docs/tdocs"
MINT_JSON="../docs/mint.json"

# Generate documentation using typedoc
typedoc --plugin typedoc-plugin-markdown --out $BASE_DIR
# Remove unwanted files
rm -f "$BASE_DIR/README.md"
rm -f "$BASE_DIR/modules.md"
rm -rf "$BASE_DIR/modules/tsconfig.md"
rm -rf "$BASE_DIR/modules/tailwind_config.md"
rm -rf "$BASE_DIR/modules/eslint_config_custom.md"

# Find all Markdown files in the directory, then use sed to remove the '.md' suffix from links
find "$BASE_DIR" -type f -name "*.md" -print0 | xargs -0 sed -i'' -e 's/(\([^)]*\)\.md)/(\1)/g'

# Rename .md files to .mdx
find "$BASE_DIR" -type f -name "*.md" -exec sh -c '
  for file do
    mv -- "$file" "${file%.md}.mdx"
  done
' sh {} +

# Generate JSON structure using jq and save it into a variable
# List all .mdx files in the directory and format them into the specified JSON structure
json_modules=$(find "$BASE_DIR/modules" -type f -name "*.mdx" | sed 's/\.mdx$//' | sed 's|^\.\./docs/||' | jq -R -s -c '{
  group: "Modules",
  pages: (split("\n") | map(select(. != "")))
}')

json_classes=$(find "$BASE_DIR/classes" -type f -name "*.mdx" | sed 's/\.mdx$//' | sed 's|^\.\./docs/||' | jq -R -s -c '{
  group: "Classes",
  pages: (split("\n") | map(select(. != "")))
}')

json_interfaces=$(find "$BASE_DIR/interfaces" -type f -name "*.mdx" | sed 's/\.mdx$//' | sed 's|^\.\./docs/||' | jq -R -s -c '{
  group: "Interfaces",
  pages: (split("\n") | map(select(. != "")))
}')

jq --argjson modules "$json_modules" \
   --argjson classes "$json_classes" \
   --argjson interfaces "$json_interfaces" \
   'del(.navigation[] | select(.group == "Modules" or .group == "Classes" or .group == "Interfaces")) |
    .navigation += [$modules, $classes, $interfaces]' "$MINT_JSON" > temp.json && mv temp.json "$MINT_JSON"


# http://localhost:3000/tdocs/classes/copilotkit_backend.OpenAIAdapter.md
# http://localhost:3000/tdocs/classes/copilotkit_backend.OpenAIAdapter