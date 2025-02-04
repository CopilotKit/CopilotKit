from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task


@CrewBase
class PoetCrew():
    """Poet crew"""

    @agent
    def poet(self) -> Agent:
        """Poet agent"""
        return Agent(
          role='Poet',
          goal='Write a poem',
          backstory='You are a great street poet who knows how to write a poem about any topic',
          verbose=False,
          allow_delegation=False,
        )

    @task
    def write_poem_task(self) -> Task:
        """Write poem task"""
        return Task(
          config=self.tasks_config['write_poem_task'] # pylint: disable=no-member
        )

    @crew
    def crew(self) -> Crew:
        """Poet crew"""
        return Crew(
          agents=[
            self.poet(),
          ],
          tasks=[
            self.write_poem_task()
          ],
          process=Process.sequential,
          chat_llm="gpt-4o"
        )

