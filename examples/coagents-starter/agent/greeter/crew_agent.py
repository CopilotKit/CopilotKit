from typing import Type
from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task
from crewai.tools import BaseTool
from pydantic import BaseModel, Field
from copilotkit.crewai import copilotkit_execute_action


# class AskUserForClarificationInput(BaseModel):
#     """Input schema for AskUserForClarification."""
#     question: str = Field(..., description="The question to ask the user for clarification.")


# class AskUserForClarification(BaseTool):
#     """Ask the user for clarification"""
#     name: str = "ask_user_for_clarification"
#     description: str = "Ask the user for clarification"
#     args_schema: Type[BaseModel] = AskUserForClarificationInput

#     def _run(self, *args, **kwargs):
#         return copilotkit_execute_action(
#             name="AskUserForClarification",
#             args={"question": kwargs.get("question")}
#         )

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
          tools=[
              # AskUserForClarification(result_as_answer=True)
          ]
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


# test_crew = PoetCrew().crew()
