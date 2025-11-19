## 🚀 **Meal Planner with CopilotKit Direct-to-LLM Integration**

### 📝 **Intelligent Recipe Planning and Management**

This project showcases how to use CopilotKit direct-to-LLM integration to connect a React frontend with any external agent that supports AGUI (Pydantic AI in this case) through a middleware layer.

This example includes a mini meal planner agent configured as a demonstration of the integration.

---

### 🛠️ **Technologies Being Used**

**Frontend:**

- **Framework**: React 19 - Vite
- **UI Components**: CopilotKit React UI (@copilotkit/react-ui)
- **Styling**: Custom CSS

**Backend Middleware:**

- **Runtime**: Node/Express.js
- **Packages**: @copilotkit/runtime, @ag-ui/client

**AI Agent:**

- **Framework**: Pydantic AI with FastAPI
- **LLM Provider**: Google Gemini via Pydantic AI

---

### How It Works

- The React frontend uses CopilotKit UI components to provide a chat interface
- User messages are sent to the middleware that exposes a graphql server
- The middleware forwards requests to the Pydantic AI agent using the AG-UI protocol
- The agent processes requests
- Responses flow back through the middleware to the frontend

### 🌐 **App Link**

-- NOT HOSTED --

---

### 🎯 **Twitter Post**

[Link to your Twitter/X post.](https://x.com/anandsan_/status/1987927360747041011)

---

### 📸 **Screenshot**

<img width="1283" height="731" alt="Screenshot 2025-11-10 at 9 07 31 PM" src="https://github.com/user-attachments/assets/ac8a7da3-6f5e-43d6-91c5-d5b6406f0fe0" />

<img width="1422" height="765" alt="Screenshot 2025-11-10 at 9 07 08 PM" src="https://github.com/user-attachments/assets/b49d27a6-49c8-4937-9446-f8dcb437cef5" />

---

### 🙋♂️ **List your repo here**

[CopilotKit Direct-to-LLM Pydantic Agent Example](https://github.com/anand-san/copilotkit-direct-to-llm-example)
