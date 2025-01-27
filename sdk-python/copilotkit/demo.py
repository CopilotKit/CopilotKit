"""Demo script for CopilotKit"""
import asyncio
from typing import Any, cast
from copilotkit.crewai_agent import CrewAIAgent

def main():
    """Main function"""
    agent = CrewAIAgent(name="test", flow=cast(Any, "fake_flow"))
    asyncio.run(agent.execute_flow(state={}, messages=[], thread_id=None, actions=None))

if __name__ == "__main__":
    main()
