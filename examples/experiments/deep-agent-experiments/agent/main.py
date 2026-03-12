import logging
import os

# Configure agent logging. Set AGENT_LOG_LEVEL=DEBUG to see router
# classifications and recommendation intermediate LLM responses.
logging.basicConfig(
    level=os.getenv("AGENT_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    force=True,  # Survive uvicorn's dictConfig when reload=True
)



def main():
    print("Hello from deep-agent!")


if __name__ == "__main__":
    main()
