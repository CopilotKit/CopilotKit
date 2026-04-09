#!/bin/bash
# Deploy a starter to Railway with patched Next.js version
DIR="$1"
SVC="$2"

if [ -z "$DIR" ] || [ -z "$SVC" ]; then
  echo "Usage: deploy-starter.sh <examples/integrations/dir> <service-name>"
  exit 1
fi

# Create temp copy
TMPDIR=$(mktemp -d)
cp -r "$DIR"/* "$TMPDIR/" 2>/dev/null
cp -r "$DIR"/.[!.]* "$TMPDIR/" 2>/dev/null

# Patch Next.js version in package.json
if [ -f "$TMPDIR/package.json" ]; then
  node -e "
    const p = JSON.parse(require('fs').readFileSync('$TMPDIR/package.json','utf8'));
    if (p.dependencies && p.dependencies.next) p.dependencies.next = '^16.0.0';
    if (p.devDependencies && p.devDependencies.next) p.devDependencies.next = '^16.0.0';
    require('fs').writeFileSync('$TMPDIR/package.json', JSON.stringify(p, null, 2) + '\n');
  "
  echo "Patched package.json: next → ^16.0.0"
fi

# Deploy from temp dir
cd "$TMPDIR"
railway up . --service "$SVC" --project 6f8c6bff-a80d-4f8f-b78d-50b32bcf4479 --environment production --path-as-root --detach
EXIT=$?

# Cleanup
rm -rf "$TMPDIR"
exit $EXIT
