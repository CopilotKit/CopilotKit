# Travel Planner

Plan your next trip with an AI-powered travel planner. This demo showcases a travel application where an AI assistant helps you create, manage, and explore trips with real-time map visualization and Google Maps integration.

[Click here for a running example](https://copilotkit.ai/examples/travel-planner)

<div align="center">

  <a href="https://copilotkit.ai" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-CopilotKit-6963ff" alt="Built with CopilotKit"/>
  </a>
  <a href="https://nextjs.org" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-Next.js%2014-black" alt="Built with Next.js"/>
  </a>
  <a href="https://www.langchain.com/langgraph" target="_blank">
    <img src="https://img.shields.io/badge/Powered%20by-LangGraph-blue" alt="Powered by LangGraph"/>
  </a>
  <a href="https://leafletjs.com/" target="_blank">
    <img src="https://img.shields.io/badge/Maps%20by-Leaflet-199900" alt="Maps by Leaflet"/>
  </a>
</div>

## Tutorial Video

<a href="https://www.youtube.com/watch?v=9v3kXiOY3vg" target="_blank">
  <img src="https://img.youtube.com/vi/9v3kXiOY3vg/hqdefault.jpg" alt="Travel Planner Tutorial" width="600"/>
</a>

## Overview

This application demonstrates the power of CopilotKit working with an Agent Framework (LangGraph in this case), where the agent shares state with your React frontend, enabling seamless AI-human collaboration. Key features include:

- **Interactive Map** - Visualize your trips and places on a Leaflet-powered map
- **Google Maps Search** - The AI agent can search for real places using Google Maps API
- **Human-in-the-Loop** - Review and approve AI-suggested changes before they're applied
- **Shared State** - The AI agent and UI share the same state, keeping everything in sync
- **Smart Suggestions** - Context-aware chat suggestions based on your current trips

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+ with [uv](https://docs.astral.sh/uv/) package manager
- npm, yarn, or pnpm

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/CopilotKit/CopilotKit.git
   cd CopilotKit/examples/v1/travel
   ```

2. Install frontend dependencies:

   ```bash
   pnpm install
   ```

   <details>
     <summary><b>Using other package managers</b></summary>

   ```bash
   # Using yarn
   yarn install

   # Using npm
   npm install
   ```

   </details>

3. Install agent dependencies:

   ```bash
   pnpm install:agent
   ```

4. Create a `.env` file in the project root:

   ```
   OPENAI_API_KEY=your_openai_api_key
   GOOGLE_MAPS_API_KEY=your_google_maps_api_key
   ```

   Alternatively, use [Copilot Cloud](https://cloud.copilotkit.ai) by setting:

   ```
   NEXT_PUBLIC_CPK_PUBLIC_API_KEY=your_copilotkit_api_key
   ```

5. Start the development server (runs both frontend and agent):

   ```bash
   pnpm dev
   ```

   <details>
     <summary><b>Using other package managers</b></summary>

   ```bash
   # Using yarn
   yarn dev

   # Using npm
   npm run dev
   ```

   </details>

6. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.
