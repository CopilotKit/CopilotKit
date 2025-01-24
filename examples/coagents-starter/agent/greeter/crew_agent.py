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
          goal='Answer with a poem',
          backstory='You are a great street poet who knows an answer to anything',
          verbose=False,
          allow_delegation=False,
        )

    @task
    def answer_question_task(self) -> Task:
        """Answer question task"""
        return Task(
          config=self.tasks_config['answer_question_task'] # pylint: disable=no-member
        )

    @crew
    def crew(self) -> Crew:
        """Poet crew"""
        return Crew(
          agents=[
            self.poet(),
          ],
          tasks=[
            self.answer_question_task()
          ],
          process=Process.sequential
        )


test_crew = PoetCrew().crew()
