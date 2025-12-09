#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Create the next app in /tmp
CSS_APP_PATH="/tmp/test-css-app"
echo "Creating next app in $CSS_APP_PATH"
echo ""

# Remove prev project and run create-next-app
rm -rf $CSS_APP_PATH
npx create-next-app $CSS_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"

# write to .env
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $CSS_APP_PATH/.env

npm_install_packages $CSS_APP_PATH 

cp scripts/qa/lib/css/page.tsx $CSS_APP_PATH/src/app/page.tsx

# Open VSCode
code $CSS_APP_PATH

mkdir -p $CSS_APP_PATH/src/app/api/copilotkit/openai/
cp scripts/qa/lib/css/route.ts $CSS_APP_PATH/src/app/api/copilotkit/openai/route.ts


# Temporarily disable -e 
set +e

pushd $CSS_APP_PATH

npm run build

exit_status=$?

if [ $exit_status -eq 0 ]; then
    succeed "$pkg_manager build succeeded."
else
    fail "$pkg_manager build failed with status $exit_status."
    exit 1
fi

# Re-enable -e
set -e

npm run dev > /dev/null 2>&1 &

pid1=$!

popd

prompt "Open http://localhost:3000. Does it load with custom colors and icons?"

killall next-server;

succeed "Test completed successfully."

echo "===================="
echo "Test completed at $(date)"
echo "===================="

exit 0
