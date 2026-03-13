"""
Example for serving you Agno agent as an AG-UI server
"""

import dotenv
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI

from src.agent import agent

dotenv.load_dotenv()

# Build AgentOS and extract the app for serving
agent_os = AgentOS(agents=[agent], interfaces=[AGUI(agent=agent)])
app = agent_os.get_app()

if __name__ == "__main__":
    agent_os.serve(app="main:app", port=8000, reload=True)
