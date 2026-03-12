# CopilotKit Jupyter Notebook

A Jupyter notebook environment for developing LangGraph agents with CopilotKit.

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Node.js 18+
- OpenAI API key

## Setup

1. Install Python dependencies:
   ```bash
   uv sync
   ```

2. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```

3. Set your OpenAI API key:
   ```bash
   export OPENAI_API_KEY=your-api-key
   ```

## Usage

Start the notebook:

```bash
uv run jupyter notebook dev.ipynb
```

Or with JupyterLab:

```bash
uv run jupyter lab dev.ipynb
```

Then run the cells in order:

1. **Start Backend Server** - Launches the FastAPI server on port 8000
2. **Define Agent Graph** - Configure your LangGraph agent
3. **Customize Frontend** - Edit the React UI
4. **Start Frontend** - Launches Next.js on port 3000

Open http://localhost:3000 to interact with your agent.

## Hot Reload

- Re-run **Define Agent Graph** to update agent behavior without restarting
- Re-run **Customize Frontend** to update the UI (Next.js hot-reloads automatically)
