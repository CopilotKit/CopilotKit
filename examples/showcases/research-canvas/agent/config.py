from langchain_openai import ChatOpenAI

# Description: Configuration file
class Config:
    def __init__(self):
        """
        Initializes the configuration for the agent
        """
        self.BASE_LLM = ChatOpenAI(model="gpt-4", temperature=0.2)
        self.FACTUAL_LLM = ChatOpenAI(model="gpt-4o-mini", temperature=0.0)
        self.DEBUG = False