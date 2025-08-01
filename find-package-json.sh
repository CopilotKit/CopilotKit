#!/bin/bash

# Find all package.json files, excluding various build/dependency directories
package_files=$(find . -name "package.json" \
  -not -path "*/node_modules/*" \
  -not -path "*/.github/*" \
  -not -path "*/.next/*" \
  -not -path "*/.venv/*" \
  -not -path "*/.mastra/*" \
  -not -path "./package.json" \
  -not -path "./docs/*" \
  -not -path "./infra/*" \
  -not -path "./registry/*" \
  -not -path "*/utilities/*" \
  -not -path "*/next-pages-router/*" \
  -not -path "*/node-express/*" \
  -not -path "*/node-http/*" \
  -not -path "*/scripts/qa/*" | sort)

# If no argument provided, just list the files
if [ "$1" != "install" ]; then
  echo "$package_files"
  exit 0
fi

# Install dependencies based on lockfile
echo "Installing dependencies in all package.json directories..."
echo ""

for package_file in $package_files; do
  dir=$(dirname "$package_file")
  echo "📦 Installing in: $dir"
  
  cd "$dir" || continue
  
  # Check for lockfile and install accordingly
  if [ -f "pnpm-lock.yaml" ]; then
    echo "  Using pnpm install..."
    pnpm install
  elif [ -f "package-lock.json" ]; then
    echo "  Using npm install..."
    npm install
  elif [ -f "yarn.lock" ]; then
    echo "  Using yarn install..."
    yarn install
  else
    echo "  ⚠️  No lockfile found, using pnpm install..."
    pnpm install
  fi
  
  # Return to original directory
  cd - > /dev/null
  echo ""
done

echo "✅ Installation complete!"