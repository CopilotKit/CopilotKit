"""Demo"""

import os
from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from my_agent.agent import graph


app = FastAPI()
sdk = CopilotKitSDK(
    agents=[
        LangGraphAgent(
            name="weather_agent",
            description="This agent deals with everything weather related",
            agent=graph,
        )
    ],
)
import os
import time
from dotenv import load_dotenv
load_dotenv()  # pylint: disable=wrong-import-position

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from my_agent.agent import graph

app = FastAPI()
sdk = CopilotKitSDK(
    agents=[
        LangGraphAgent(
            name="weather_agent",
            description="This agent deals with everything weather related",
            agent=graph,
        )
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")

def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8001"))
    while True:
        try:
            uvicorn.run("my_agent.demo:app", host="0.0.0.0", port=port, reload=True)
        except Exception as e:
            print(f"Server crashed due to {e}, restarting in 5 seconds...")
            time.sleep(5)  # Delay before restarting

if __name__ == "__main__":
    main()