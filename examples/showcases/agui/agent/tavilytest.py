import json
from dotenv import load_dotenv
from tavily import TavilyClient
load_dotenv()
tavily_client = TavilyClient()
response = tavily_client.search("Latest news on AI",'basic','news','week',7,3)

# response = tavily_client.extract("https://apnews.com/politics",False,'basic')

print(json.dumps(response, indent=2))