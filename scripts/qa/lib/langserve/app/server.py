#!/usr/bin/env python
"""Example LangChain server exposes multiple runnables (LLMs in this case)."""

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from langchain_openai import ChatOpenAI
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings
from langchain.agents import AgentExecutor, tool
from langchain_core.utils.function_calling import convert_to_openai_function
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.agents.output_parsers.openai_functions import OpenAIFunctionsAgentOutputParser
from pydantic import BaseModel
from typing import Any
from langchain.agents.format_scratchpad.openai_functions import format_to_openai_functions

from langserve import add_routes

app = FastAPI(
    title="LangChain Server",
    version="1.0",
    description="Spin up a simple api server using Langchain's Runnable interfaces",
)

# ChatOpenAI
# ----------
# We probably can't support ChatOpenAI...
# see input schema: http://localhost:8000/openai/input_schema
# also playground: http://localhost:8000/openai/playground/
# it looks tricky to support this in a generic way
add_routes(
    app,
    ChatOpenAI(),
    path="/openai",
)

# Retriever
# ---------
# receives a single input VectorStoreRetrieverInput (type string)
# Input Schema: {"title":"VectorStoreRetrieverInput","type":"string"}
# according to the client docs, it can be called like this:
# - requests.post("http://localhost:8000/invoke", json={"input": "tree"})
# - remote_runnable.invoke("tree")
vectorstore = FAISS.from_texts(
    ["cats like fish", "dogs like sticks"], embedding=OpenAIEmbeddings()
)
retriever = vectorstore.as_retriever()

add_routes(
    app,
    retriever,
    path="/retriever",
)


# Agent
# -----
# Input Schema: {"title":"Input","type":"object","properties":{"input":{"title":"Input","type":"string"}},"required":["input"]}
# - requests.post("http://localhost:8000/invoke", json={"input": {"input": "what does eugene think of cats?"}})
# - remote_runnable.invoke({"input": "what does eugene think of cats?"})
@tool
def get_eugene_thoughts(query: str) -> list:
    """Returns Eugene's thoughts on a topic."""
    return retriever.get_relevant_documents(query)


tools = [get_eugene_thoughts]
llm = ChatOpenAI(model="gpt-3.5-turbo", temperature=0, streaming=True)
llm_with_tools = llm.bind(functions=[convert_to_openai_function(t) for t in tools])
prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "You are a helpful assistant."),
        ("user", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ]
)
agent = (
    {
        "input": lambda x: x["input"],
        "agent_scratchpad": lambda x: format_to_openai_functions(
            x["intermediate_steps"]
        ),
    }
    | prompt
    | llm_with_tools
    | OpenAIFunctionsAgentOutputParser()
)
agent_executor = AgentExecutor(graph=agent, tools=tools)


class Input(BaseModel):
    input: str


class Output(BaseModel):
    output: Any


add_routes(
    app,
    agent_executor.with_types(input_type=Input, output_type=Output).with_config(
        {"run_name": "agent"}
    ),
    path="/agent",
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="localhost", port=8000)
