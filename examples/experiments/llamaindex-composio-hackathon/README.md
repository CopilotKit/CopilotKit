# LlamaIndex Composio Hackathon Project

A full-stack AI-powered story generation application built with Next.js, LlamaIndex, and Composio. This project combines a modern React frontend with an AI agent backend that can integrate with external services through Composio tools.

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and **pnpm** (for frontend)
- **Python** 3.9-3.13 and **uv** (for backend agent)
- **OpenAI API Key** (required)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd llamaindex-composio-hackathon
   ```

2. **Install dependencies**
   ```bash
   # Install frontend dependencies
   pnpm install
   
   # Install backend dependencies
   npm run install:agent
   # or manually: cd agent && uv sync
   ```

3. **Set up environment variables** (see [Environment Variables](#environment-variables) section below)

4. **Run the development server**
   ```bash
   # Run both frontend and backend concurrently
   pnpm run dev
   
   # Or run them separately:
   pnpm run dev:ui      # Frontend only (http://localhost:3000)
   pnpm run dev:agent   # Backend only (http://localhost:9000)
   ```

## 📋 Environment Variables

Create a `.env` file in the project root or in the `agent/` directory with the following variables:

### Required Variables

```bash
# OpenAI API Key (Required)
OPENAI_API_KEY=sk-your-openai-api-key-here
```

### Environment File Locations

The application will automatically load environment variables from these locations (in order of precedence):

1. `/.env.local` (project root)
2. `/.env` (project root)
3. `/agent/.env.local` (agent directory)
4. `/agent/.env` (agent directory)

## 🏗️ Project Structure

```
llamaindex-composio-hackathon/
├── src/                    # Next.js frontend
│   ├── app/
│   │   ├── api/copilotkit/ # CopilotKit API endpoint
│   │   ├── layout.tsx      # Root layout
│   │   └── page.tsx        # Main page
│   └── components/         # React components
│       ├── canvas/         # Canvas-related components
│       └── ui/             # UI components
├── agent/                  # Python backend agent
│   ├── agent/
│   │   ├── agent.py        # Main agent logic
│   │   ├── prompts.py      # System prompts
│   │   └── server.py       # FastAPI server
│   └── pyproject.toml      # Python dependencies
├── package.json            # Node.js dependencies
└── README.md              # This file
```

## 🛠️ Available Scripts

### Frontend (Next.js)
```bash
npm run dev:ui          # Start development server
npm run build           # Build for production
npm run start           # Start production server
npm run lint            # Run ESLint
```

### Backend (Python Agent)
```bash
npm run dev:agent       # Start agent development server
npm run install:agent   # Install agent dependencies
```

### Combined
```bash
npm run dev             # Run both frontend and backend
npm run dev:debug       # Run with debug logging (LOG_LEVEL=debug)
```

## 🤖 How It Works

1. **Frontend**: A Next.js application with a canvas-based story creation interface
2. **Backend Agent**: A LlamaIndex-powered AI agent that:
   - Generates stories based on user input
   - Provides angle selection for story direction
   - Can integrate with external services via Composio tools
3. **Integration**: CopilotKit connects the frontend and backend, enabling real-time AI interactions

## 🎥 Demo Video

[![Canvas with LlamaIndex & Composio Demo](https://cdn.loom.com/sessions/thumbnails/743936d412994efdba1e1f418f28543f-with-play.gif)](https://www.loom.com/share/743936d412994efdba1e1f418f28543f?sid=db045975-d13c-47bf-a769-085530858092)

*Click the image above to watch the demo video*

---

**Direct Video Link**: [Watch Demo Video](https://www.loom.com/share/743936d412994efdba1e1f418f28543f?sid=db045975-d13c-47bf-a769-085530858092)