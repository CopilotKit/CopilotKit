const fs = require("fs");
const path = require("path");

// Configuration mapping demo IDs (including framework prefix) to their files
// TODO: This needs to be kept in sync with the actual agent/demo structure
const config = {
  crewai_agentic_chat: ["agent.py", "page.tsx", "style.css", "README.mdx"],
  crewai_agentic_generative_ui: ["agent.py", "page.tsx", "style.css", "README.mdx"],
  crewai_human_in_the_loop: ["agent.py", "page.tsx", "style.css", "README.mdx"],
  crewai_shared_state: ["README.mdx","agent.py", "page.tsx", "style.css", "README.mdx"], 
  crewai_predictive_state_updates: ["agent.py", "page.tsx", "style.css", "README.mdx"],
  crewai_tool_based_generative_ui: ["agent.py", "page.tsx", "style.css", "README.mdx"],
  crewai_crew_enterprise: [
    "restaurant_finder_crew/src/config/__init__.py",
    "restaurant_finder_crew/src/config/agents.yaml",
    "restaurant_finder_crew/src/config/tasks.yaml",
    "restaurant_finder_crew/src/tools/__init__.py",
    "restaurant_finder_crew/src/tools/custom_tool.py",
    "restaurant_finder_crew/src/crew.py",
    "restaurant_finder_crew/src/main.py",
    "restaurant_finder_crew/pyproject.toml",
    "restaurant_finder_crew/README.md",
    "restaurant_finder_crew/README.mdx",
    "restaurant_finder_crew/code.tsx"
  ],
 
  langgraph_agentic_chat: ["agent.py", "page.tsx", "style.css", "README.mdx"],
  langgraph_human_in_the_loop: ["agent.py", "page.tsx", "style.css", "README.mdx"],
  langgraph_agentic_generative_ui: ["agent.py", "page.tsx", "style.css", "README.mdx"],
  langgraph_tool_based_generative_ui: ["agent.py", "page.tsx", "style.css", "README.mdx"],
  langgraph_shared_state: ["README.md","agent.py", "page.tsx", "style.css", "README.mdx"],
  langgraph_predictive_state_updates: ["agent.py", "page.tsx", "style.css", "README.mdx"],
  langgraph_no_chat: ["agent.py", "page.tsx", "style.css", "README.mdx"],

  standard_agentic_chat: ["page.tsx", "style.css", "README.mdx"],
  standard_human_in_the_loop: ["page.tsx", "style.css", "README.mdx"],
  standard_agentic_generative_ui: ["page.tsx", "style.css", "README.mdx"],
  standard_tool_based_generative_ui: ["page.tsx", "style.css", "README.mdx"],
  standard_shared_state: ["page.tsx", "style.css", "README.mdx"],
  standard_predictive_state_updates: ["page.tsx", "style.css", "README.mdx"],
};

const result = {};
const agentDemoBaseDir = path.join(__dirname, "../agent/demo");

for (const demoIdWithFramework in config) {
  const demoFilesConfig = config[demoIdWithFramework];
  const demoDirPath = path.join(agentDemoBaseDir, demoIdWithFramework);
  
  if (!fs.existsSync(demoDirPath)) {
    console.warn(`Directory not found for demo: ${demoIdWithFramework}, skipping.`);
    continue;
  }
  
  result[demoIdWithFramework] = { files: [] };

  for (const fileName of demoFilesConfig) {
    const filePath = path.join(demoDirPath, fileName);
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}, skipping.`);
      continue;
    }
    
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const extension = fileName.split(".").pop();
      let language = extension;
      if (extension === "py") language = "python";
      else if (extension === "css") language = "css";
      else if (extension === "md" || extension === "mdx") language = "markdown";
      else if (extension === "tsx") language = "typescript";
      else if (extension === "js") language = "javascript";
      else if (extension === "json") language = "json";
      else if (extension === "yaml" || extension === "yml") language = "yaml";
      else if (extension === "toml") language = "toml";

      result[demoIdWithFramework].files.push({
        name: fileName,
        content,
        path: path.join(demoIdWithFramework, fileName), // Store relative path within agent/demo
        language,
        type: 'file'
      });
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
    }
  }
}

fs.writeFileSync(
  path.join(__dirname, "../src/files.json"),
  JSON.stringify(result, null, 2)
);

console.log("Successfully generated src/files.json");
