<cursor-tools Integration>
# Instructions
Use the following commands to get AI assistance:

cursor-tools web "your question"  - Get answers from the web using Perplexity AI
cursor-tools repo "your question" - Get context-aware answers about this repository using Google Gemini
cursor-tools doc [options] - Generate comprehensive documentation for this repository
cursor-tools github pr [number] - Get the last 10 PRs, or a specific PR by number
cursor-tools github issue [number] - Get the last 10 issues, or a specific issue by number

cursor-tools web is good for getting up-to-date information from the web that are not repository specific. For example, you can ask it to get the names and details of the latest OpenAI models or details about an external API.
cursor-tools repo has the entire repository context available to it so it is good for repository search and tasks that require holistic understanding such as planning, debugging and answering questions about the architecture.
cursor-tools doc can generate comprehensive documentation for your repository, with options like --output to save to a file and --fromGithub to document a remote GitHub repository.

Running the commands:
1. Using the installed version:
   If cursor-tools is in your path run it as `cursor-tools <your command>`. If it is not found in your PATH, you can run it with `npm exec cursor-tools "your question"` or `yarn cursor-tools "your question"` or `pnpm cursor-tools "your question"` depending on your package manager - if cursor-tools is installed as a local dependency. If cursor-tools is not installed as a dependency you should fall back to using `npx -y cursor-tools@latest "your question"` or `bunx -y cursor-tools@latest "your question"` if you have bun installed.

## Additional command options
All commands support these general options:
--model=<model name>: Specify an alternative AI model to use
--max-tokens=<number>: Control response length
--save-to=<file path>: Save command output to a file (in *addition* to displaying it, like tee)
--help: View all available options (help has not been implemented for all commands yet)

Documentation command specific options:
--from-github=<GitHub username>/<repository name>[@<branch>]: Generate documentation for a remote GitHub repository

GitHub command specific options:
--from-github=<GitHub username>/<repository name>[@<branch>]: Access PRs/issues from a specific GitHub repository

## Notes
- more information about cursor-tools can be found in node_modules/cursor-tools/README.md if installed locally.
- configuration is in cursor-tools.config.json (falling back to ~/.cursor-tools/config.json)
- api keys are loaded from .cursor-tools.env (falling back to ~/.cursor-tools/.env)
<!-- cursor-tools-version: 0.4.1 -->
</cursor-tools Integration>