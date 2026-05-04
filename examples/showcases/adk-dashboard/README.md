# CopilotKit + ADK Generative Canvas

https://github.com/user-attachments/assets/9201d528-573f-43cc-9d31-571c362318a7

---

This project provides a **Canvas UI** for building and running agents with [Google’s ADK](https://google.github.io/adk-docs/), [AG-UI](https://docs.ag-ui.com/introduction), and [CopilotKit](https://github.com/CopilotKit/CopilotKit).

Instead of plain text, the agent can **populate metrics, charts, and real-time data** into the Canvas dashboard.

---

## 🔧 Quickstart

```bash
git clone https://github.com/your-org/copilotkit-adk-canvas
cd copilotkit-adk-canvas

# install JS deps + agent
pnpm install        # or npm/yarn/bun

# install Python deps separately for the ADK agent
pnpm install:agent

# set your Google API key
export GOOGLE_API_KEY="your-google-api-key-here"

# start UI + agent together
pnpm run dev

```

### 📦 Prerequisites

- Node.js 18+
- Python 3.8+
- Google Makersuite API Key → get one [here](https://makersuite.google.com/)
- Any package manager (pnpm recommended)

💡 Lockfiles (`package-lock.json`, `yarn.lock`, etc.) are gitignored — each dev manages their own.

---

### 🛠 Available Scripts

- `dev` → Start UI + agent (default)
- `dev:debug` → Start with debug logging
- `dev:ui` → Run just the Next.js app
- `dev:agent` → Run just the ADK agent
- `build / start` → Production build + server
- `lint` → Run ESLint
- `install:agent` → Install Python deps inside `agent/.venv`

---

### 🎨 Customization

- **Main UI** → `src/app/page.tsx`
- Change theme/colors and sidebar appearance
- Add new visualization components
- Extend agent logic in `/agent`

---

### 📚 Docs

- [ADK](https://google.github.io/adk-docs/)
- [CopilotKit](https://github.com/CopilotKit/CopilotKit)
- [AG-UI](https://docs.ag-ui.com/introduction)

---

### 🐛 Troubleshooting

**Agent connection issues?**

- Ensure ADK agent runs on port `8000`
- Double-check `GOOGLE_API_KEY`
- Confirm both servers boot without errors

---

### 🤝 Contributing

PRs and issues welcome — this Canvas is meant to be hacked on.

---

### 📄 License

MIT — see [LICENSE](./LICENSE) for details.
