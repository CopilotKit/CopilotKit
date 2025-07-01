import { danger, warn } from "danger";

const file1 = "sdk-python/copilotkit/langgraph_agent.py";
const file2 = "CopilotKit/packages/sdk-js/src/langgraph.ts";

// Get the list of modified files in the PR
const changedFiles = danger.git.modified_files;
const lgPyExecutorName = "LangGraph python executor (langgraph_agent.py)";
const lgcExecutor = "LangGraph Cloud executor (remote-lg-cloud-action.ts)";

// Check if only one of the files is modified
if (changedFiles.includes(file1) && !changedFiles.includes(file2)) {
  warn(
    `⚠️ ${lgPyExecutorName} was modified, but ${lgcExecutor} was not updated. Please align both files.`
  );
}

if (changedFiles.includes(file2) && !changedFiles.includes(file1)) {
  warn(
    `⚠️ ${lgcExecutor} was modified, but ${lgPyExecutorName} was not updated. Please align both files.`
  );
}
