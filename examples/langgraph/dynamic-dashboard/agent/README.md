# Dynamic SaaS Dashboard

This project is a dynamic SaaS dashboard built with Next.js (in the `frontend` directory). It features:
- Clean, responsive UI for PR and repository analytics
- Interactive charts and tables
- Integration with OpenAI via CopilotKit

## Backend Agent

1. **Install dependencies**
   ```bash
   cd agent
   poetry install
   ```

2. **Set up environment variables**
   - Create a `.env` file in the `agent` directory:
     ```bash
     echo "OPENAI_API_KEY=your_openai_api_key_here" > .env
     ```
   - Replace `your_openai_api_key_here` with your actual OpenAI API key.

3. **Run the Langgraph server**
   ```bash
   python agent.py
   ```

---

To refer to the recording to the demo, Refer here : 
```bash 
https://www.loom.com/share/43be7bcbf1954672934e62ff8b3ee86e 
```