from crewai_tools import ScrapeWebsiteTool, SerperDevTool

from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task


@CrewBase
class SimilarCompanyFinderTemplateCrew:
    """Restaurant Recommendation Crew"""

    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    @agent
    def restaurant_researcher(self) -> Agent:
        return Agent(
            config=self.agents_config["restaurant_researcher"],
            tools=[SerperDevTool(), ScrapeWebsiteTool()],
            allow_delegation=False,
            verbose=True,
        )

    @agent
    def recommendation_specialist(self) -> Agent:
        return Agent(
            config=self.agents_config["recommendation_specialist"],
            tools=[],
            allow_delegation=False,
            verbose=True,
        )

    @task
    def search_restaurants_task(self) -> Task:
        return Task(
            config=self.tasks_config["search_restaurants_task"],
            agent=self.restaurant_researcher(),
        )

    @task
    def present_recommendations_task(self) -> Task:
        return Task(
            config=self.tasks_config["present_recommendations_task"],
            agent=self.recommendation_specialist(),
            human_input=True,
        )

    @task
    def respond_to_feedback_task(self) -> Task:
        return Task(
            config=self.tasks_config["respond_to_feedback_task"],
            agent=self.recommendation_specialist(),
            output_file="restaurant_recommendations.md",
        )

    @crew
    def crew(self) -> Crew:
        """Creates the Restaurant Recommendation crew"""
        return Crew(
            agents=self.agents,  # Automatically created by the @agent decorator
            tasks=self.tasks,  # Automatically created by the @task decorator
            process=Process.sequential,
            verbose=True,
            # process=Process.hierarchical, # In case you wanna use that instead https://docs.crewai.com/how-to/Hierarchical/
        )

    def run(self, inputs=None):
        """Run the crew
        
        Args:
            inputs (dict, optional): Input parameters for the crew
        """
        if inputs is None:
            inputs = {
                "location": "San Francisco, CA",
            }
            
        return self.crew().kickoff(inputs=inputs)
