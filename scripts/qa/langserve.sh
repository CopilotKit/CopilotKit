#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Create the next app in /tmp
LANGSERVE_APP_PATH="/tmp/test-langserve-app"
LANGSERVE_PYTHON_APP_PATH="/tmp/test-langserve-app-python"

rm -rf $LANGSERVE_APP_PATH
rm -rf $LANGSERVE_PYTHON_APP_PATH

echo "Creating langserve app in $LANGSERVE_APP_PATH and $LANGSERVE_PYTHON_APP_PATH"

# prepare the python app
mkdir -p $LANGSERVE_PYTHON_APP_PATH
mkdir -p $LANGSERVE_PYTHON_APP_PATH/app
cp "scripts/qa/lib/langserve/requirements.txt" $LANGSERVE_PYTHON_APP_PATH
cp "scripts/qa/lib/langserve/app/server.py" $LANGSERVE_PYTHON_APP_PATH/app

pushd $LANGSERVE_PYTHON_APP_PATH
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $LANGSERVE_PYTHON_APP_PATH/.env
popd

mkdir -p $LANGSERVE_APP_PATH
npx create-next-app $LANGSERVE_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $LANGSERVE_APP_PATH/.env
npm_install_packages $LANGSERVE_APP_PATH 
(cd $LANGSERVE_APP_PATH && npm install @langchain/community @langchain/core @langchain/langgraph @langchain/openai langchain openai --save)

cp scripts/qa/lib/langserve/next/page.tsx $LANGSERVE_APP_PATH/src/app/page.tsx

mkdir -p $LANGSERVE_APP_PATH/src/app/api/copilotkit/openai/

cp scripts/qa/lib/langserve/next/route.ts $LANGSERVE_APP_PATH/src/app/api/copilotkit/openai/route.ts

# Open VSCode
code $LANGSERVE_APP_PATH

prompt "Open route.ts. Is it without errors in VSCode?"

# Temporarily disable -e 
set +e

pushd $LANGSERVE_APP_PATH

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

# Start next server
npm run dev > /dev/null 2>&1 &
next_pid=$!
popd

# Start python server

pushd $LANGSERVE_PYTHON_APP_PATH
python app/server.py > /dev/null 2>&1 &
python_pid=$!
popd



prompt "Open http://localhost:3000. Is the page without errors?"
prompt "Ask it to say hello to a name. Does it say hello in a ridiculous way?"
prompt "Ask it what dogs like to check langserve. Does it say sticks?"
prompt "Ask it what Eugene thinks about cats. Does it say cats like fish?"

killall next-server;
cleanup;

succeed "Test completed successfully."

echo "===================="
echo "Test completed at $(date)"
echo "===================="

exit 0;
