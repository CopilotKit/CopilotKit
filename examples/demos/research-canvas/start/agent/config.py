from langchain_openai import ChatOpenAI


# Description: Configuration file
class Config:
    def __init__(self):
        """
        Initializes the configuration for the agent
        """
        self.BASE_LLM = ChatOpenAI(
            reasoning_effort="none", model="gpt-6-luna", temperature=0.2
        )
        self.FACTUAL_LLM = ChatOpenAI(
            reasoning_effort="none", model="gpt-6-luna", temperature=0.0
        )
        self.DEBUG = False
