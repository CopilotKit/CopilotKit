from dotenv import load_dotenv
from pydantic_ai import Agent

load_dotenv()


agent = Agent('openai:gpt-4o')


@agent.tool
def get_weather(_, location: str) -> str:
    """Get the weather for a given location. Ensure location is fully spelled out."""
    return f"The weather in {location} is sunny."
