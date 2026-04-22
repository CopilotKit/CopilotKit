from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task
from crewai.agents.agent_builder.base_agent import BaseAgent
from typing import List

from .tools.custom_tool import (
    GetWeatherTool,
    QueryDataTool,
    ScheduleMeetingTool,
    SearchFlightsTool,
    GenerateA2uiTool,
)

@CrewBase
class LatestAiDevelopment():
    """LatestAiDevelopment crew"""

    agents: List[BaseAgent]
    tasks: List[Task]
    name: str = "LatestAiDevelopment"

    @agent
    def researcher(self) -> Agent:
        return Agent(
            config=self.agents_config['researcher'],  # type: ignore[index]
            verbose=True,
            tools=[GetWeatherTool(), QueryDataTool(), ScheduleMeetingTool(), SearchFlightsTool(), GenerateA2uiTool()],
        )

    @agent
    def reporting_analyst(self) -> Agent:
        return Agent(
            config=self.agents_config['reporting_analyst'],  # type: ignore[index]
            verbose=True,
            tools=[QueryDataTool()],
        )

    @task
    def research_task(self) -> Task:
        return Task(
            config=self.tasks_config['research_task'],  # type: ignore[index]
        )

    @task
    def reporting_task(self) -> Task:
        return Task(
            config=self.tasks_config['reporting_task'],  # type: ignore[index]
            output_file='report.md'
        )

    @crew
    def crew(self) -> Crew:
        """Creates the LatestAiDevelopment crew"""
        return Crew(
            name=self.name,
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
            chat_llm="gpt-4o"
        )
