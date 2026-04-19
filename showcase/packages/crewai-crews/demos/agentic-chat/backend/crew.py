"""Agentic Chat crew: single conversational agent with a weather tool."""

from typing import List

from crewai import Agent, Crew, Process, Task
from crewai.agents.agent_builder.base_agent import BaseAgent
from crewai.project import CrewBase, agent, crew, task

from tools import GetWeatherTool


@CrewBase
class AgenticChatCrew:
    """Conversational assistant with a backend weather tool."""

    agents: List[BaseAgent]
    tasks: List[Task]
    name: str = "AgenticChat"

    @agent
    def assistant(self) -> Agent:
        return Agent(
            config=self.agents_config["assistant"],  # type: ignore[index]
            verbose=True,
            tools=[GetWeatherTool()],
        )

    @task
    def chat_task(self) -> Task:
        return Task(config=self.tasks_config["chat_task"])  # type: ignore[index]

    @crew
    def crew(self) -> Crew:
        return Crew(
            name=self.name,
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
            chat_llm="gpt-4o-mini",
        )
