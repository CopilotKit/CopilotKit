"""PraisonAI Agents for research and reporting"""

from praisonaiagents import Agent, Task, PraisonAIAgents


class ResearchAgents:
    """Research agents using PraisonAI"""
    
    def __init__(self):
        """Initialize the research agents"""
        self.researcher = Agent(
            name="Researcher",
            role="Senior Data Researcher",
            goal="Uncover cutting-edge developments in the given topic",
            backstory=(
                "You're a seasoned researcher with a knack for uncovering the latest "
                "developments in any topic. Known for your ability to find the most relevant "
                "information and present it in a clear and concise manner."
            ),
            verbose=True,
            allow_delegation=False
        )
        
        self.reporting_analyst = Agent(
            name="Reporting Analyst", 
            role="Reporting Analyst",
            goal="Create detailed reports based on data analysis and research findings",
            backstory=(
                "You're a meticulous analyst with a keen eye for detail. You're known for "
                "your ability to turn complex data into clear and concise reports, making "
                "it easy for others to understand and act on the information you provide."
            ),
            verbose=True,
            allow_delegation=False
        )
    
    def create_research_task(self, topic: str, current_year: str) -> Task:
        """Create a research task"""
        return Task(
            name="Research Task",
            description=(
                f"Conduct a thorough research about {topic}. "
                f"Make sure you find any interesting and relevant information given "
                f"the current year is {current_year}."
            ),
            expected_output=(
                f"A list with 10 bullet points of the most relevant information about {topic}"
            ),
            agent=self.researcher
        )
    
    def create_reporting_task(self, topic: str) -> Task:
        """Create a reporting task"""
        return Task(
            name="Reporting Task",
            description=(
                "Review the context you got and expand each topic into a full section for a report. "
                "Make sure the report is detailed and contains any and all relevant information."
            ),
            expected_output=(
                "A fully fledged report with the main topics, each with a full section of information. "
                "Formatted as markdown without '```'"
            ),
            agent=self.reporting_analyst
        )
    
    def create_agent_system(self, topic: str, current_year: str) -> PraisonAIAgents:
        """Create the complete agent system"""
        research_task = self.create_research_task(topic, current_year)
        reporting_task = self.create_reporting_task(topic)
        
        return PraisonAIAgents(
            agents=[self.researcher, self.reporting_analyst],
            tasks=[research_task, reporting_task],
            verbose=1,
            process="sequential"
        ) 