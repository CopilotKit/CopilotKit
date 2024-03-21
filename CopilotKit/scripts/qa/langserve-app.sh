#!/bin/bash

SCRIPT_DIR=$(dirname "${BASH_SOURCE[0]}")
source "${SCRIPT_DIR}/lib/bash/qa.sh"
source "${SCRIPT_DIR}/lib/bash/npm.sh"


prerelease_tag="$1"

if [ -z "$prerelease_tag" ]; then
  echo "Usage: $0 <prerelease_tag>"
  exit 1
fi


next_pid=0
python_pid=0

cleanup() {
  if [ $next_pid -ne 0 ]; then
    kill -9 $next_pid 2>/dev/null || true
  fi

  if [ $python_pid -ne 0 ]; then
    kill -9 $python_pid 2>/dev/null || true
  fi

  killall next-server;
}


# Trap Ctrl+C (INT signal) and exit
trap "echo 'Script interrupted.'; cleanup; exit" INT
trap "cleanup" EXIT

# Exit on any error
set -e

# record the current date + time
info "Test started at $(date)"

# Create the next app in /tmp
LANGSERVE_APP_PATH="/tmp/test-langserve-app"
LANGSERVE_PYTHON_APP_PATH="/tmp/test-langserve-app-python"
echo "Creating langserve app in $LANGSERVE_APP_PATH"

echo "Fetching pre-release versions of CopilotKit packages..."
default_packages=$(get_latest_copilotkit_prerelase_versions "$prerelease_tag")
echo "Latest pre-release versions: $default_packages"

# Install CopilotKit
echo ""
echo "Ready to install CopilotKit. Please input package names."
read -p "Enter package names separated by a space (Enter to accept latest): " packages
packages=${packages:-$default_packages}

echo ""
echo "Using CopilotKit packages: $packages"
echo ""

# only prompt for openai key if it is not set already
if [ -z "$OPENAI_API_KEY" ]; then
  read -p "Enter OpenAI API key: " OPENAI_API_KEY
else
  # Extract the first 5 characters of the API key
  key_start=${OPENAI_API_KEY:0:5}
  # Calculate the number of asterisks to print based on the key length
  num_asterisks=$((${#OPENAI_API_KEY}-5))
  asterisks=$(printf '%*s' "$num_asterisks" '' | tr ' ' '*')
  echo "Using existing OPENAI_API_KEY: $key_start$asterisks"
fi

rm -rf $LANGSERVE_APP_PATH
rm -rf $LANGSERVE_PYTHON_APP_PATH

# prepare the python app
mkdir -p $LANGSERVE_PYTHON_APP_PATH
mkdir -p $LANGSERVE_PYTHON_APP_PATH/app
cp "${SCRIPT_DIR}/lib/langserve/requirements.txt" $LANGSERVE_PYTHON_APP_PATH
cp "${SCRIPT_DIR}/lib/langserve/app/server.py" $LANGSERVE_PYTHON_APP_PATH/app

pushd $LANGSERVE_PYTHON_APP_PATH
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $LANGSERVE_PYTHON_APP_PATH/.env
popd

mkdir -p $LANGSERVE_APP_PATH
npx create-next-app $LANGSERVE_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $LANGSERVE_APP_PATH/.env
(cd $LANGSERVE_APP_PATH && npm install $packages --save)
(cd $LANGSERVE_APP_PATH && npm install @langchain/community @langchain/core @langchain/langgraph @langchain/openai langchain openai --save)

# Create the test page
cat <<EOF > $LANGSERVE_APP_PATH/src/app/page.tsx
"use client";
import {
  CopilotKit,
  useCopilotAction,
  useMakeCopilotReadable,
} from "@copilotkit/react-core";
import { CopilotTextarea } from "@copilotkit/react-textarea";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { useState } from "react";
import "@copilotkit/react-textarea/styles.css";
import "@copilotkit/react-ui/styles.css";
function InsideHome() {
  const [message, setMessage] = useState("Hello World!");
  const [text, setText] = useState("");
  useMakeCopilotReadable(
    "This is the current message: " + JSON.stringify(message)
  );
  useCopilotAction(
    {
      name: "displayMessage",
      description: "Display a message.",
      parameters: [
        {
          name: "message",
          type: "string",
          description: "The message to display.",
          required: true,
        },
      ],
      handler: async ({ message }) => {
        setMessage(message);
      },
      render: (props) => {
        return (
          <div style={{ backgroundColor: "black", color: "white" }}>
            <div>Status: {props.status}</div>
            <div>Message: {props.args.message}</div>
          </div>
        );
      },
    },
    []
  );
  return (
    <>
      <div>{message}</div>
      <CopilotTextarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autosuggestionsConfig={{
          textareaPurpose: "an outline of a presentation about elephants",
          chatApiConfigs: {},
        }}
      />
    </>
  );
}
export default function Home() {
  return (
    <CopilotKit url="/api/copilotkit/openai">
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          title: "Presentation Copilot",
          initial: "Hi you! 👋 I can give you a presentation on any topic.",
        }}
      >
        <InsideHome />
      </CopilotSidebar>
    </CopilotKit>
  );
}
EOF

mkdir -p $LANGSERVE_APP_PATH/src/app/api/copilotkit/openai/

cat <<EOF > $LANGSERVE_APP_PATH/src/app/api/copilotkit/openai/route.ts
import { CopilotBackend, OpenAIAdapter } from "@copilotkit/backend";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotBackend({
    actions: [
      {
        name: "sayHello",
        description: "Says hello to someone.",
        parameters: [
          {
            name: "name",
            type: "string",
            description: "The name of the person to say hello to.",
            required: true,
          },
        ],
        handler: async ({ name }) => {
          const prompt = ChatPromptTemplate.fromMessages([
            [
              "system",
              "The user tells you their name. Say hello to the person in the most " +
                " ridiculous way, roasting their name.",
            ],
            ["user", "My name is {name}"],
          ]);
          const chain = prompt.pipe(new ChatOpenAI());
          return chain.invoke({
            name: name,
          });
        },
      },
    ],
    langserve: [
      {
        chainUrl: "http://localhost:8000/retriever",
        name: "askAboutAnimals",
        description: "Always call this function if the users asks about a certain animal.",
      },
      {
        chainUrl: "http://localhost:8000/agent",
        name: "askAboutEugeneThoughts",
        description:
          "Always call this function if the users asks about Eugene's thoughts on a certain topic.",
      },
    ],
  });

  return copilotKit.response(req, new OpenAIAdapter());
}
EOF

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
