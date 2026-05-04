import json
from datetime import datetime
from typing import Literal, cast
from dotenv import load_dotenv

from langchain_core.messages import AIMessage, SystemMessage, HumanMessage, ToolMessage
from langgraph.graph import StateGraph
from langgraph.types import Command, interrupt
from langchain_core.runnables import RunnableConfig
from copilotkit.langchain import copilotkit_emit_state, copilotkit_customize_config
from langchain_core.tools import tool

from state import ResearchState
from config import Config
from tools.tavily_search import tavily_search
from tools.tavily_extract import tavily_extract
from tools.outline_writer import outline_writer
from tools.section_writer import section_writer

load_dotenv('.env')

cfg = Config()

@tool
def review_proposal(proposal: str) -> str:
    """
    Empty tool to route to the human to the process_feedback_node.
    """
    pass

class ResearchAgent:
    def __init__(self):
        """
        Initialize the ResearchAgent.
        """
        self._initialize_tools()
        self._build_workflow()

    def _initialize_tools(self):
        """
        Initialize the available tools and create a name-to-tool mapping.
        """
        self.tools = [tavily_search, tavily_extract, outline_writer, section_writer, review_proposal]
        self.tools_by_name = {tool.name: tool for tool in self.tools} # for easy lookup

    def _build_workflow(self):
        """
        Build the workflow graph with nodes and edges.
        """
        workflow = StateGraph(ResearchState)
        
        # Add nodes
        workflow.add_node("call_model_node", self.call_model_node)
        workflow.add_node("tool_node", self.tool_node)
        workflow.add_node("process_feedback_node", self.process_feedback_node)

        # Define graph structure
        workflow.set_entry_point("call_model_node")
        workflow.set_finish_point("call_model_node")
        workflow.add_edge("tool_node", "call_model_node")
        workflow.add_edge("process_feedback_node", "call_model_node")

        self.graph = workflow.compile()

    def _build_system_prompt(self, state: ResearchState) -> str:
        """
        Build the system prompt based on current state.
        """
        outline = state.get("outline", {})
        sections = state.get("sections", [])
        proposal = state.get("proposal", {})
        
        # The LLM is only aware of what it is told. When we build the system prompt, we give
        # it context to the LangGraph state and various other pieces of information.
        prompt_parts = [
            f"Today's date is {datetime.now().strftime('%d/%m/%Y')}.",
            "You are an expert research assistant, dedicated to helping users create comprehensive, well-sourced research reports. Your primary goal is to assist the user in producing a polished, professional report tailored to their needs.\n\n"
            "When writing a report use the following research tools:\n"
            "1. Use the tavily_search tool to start the research and gather additional information from credible online sources when needed.\n"
            "2. Use the tavily_extract tool to extract additional content from relevant URLs.\n"
            "3. Use the outline_writer tool to analyze the gathered information and organize it into a clear, logical **outline proposal**. Break the content into meaningful sections that will guide the report structure. You must use the outline_writer EVERY time you need to write an outline for the report\n"
            "4. Use the review_proposal tool to review the outline proposal and get feedback from the user.\n"
            f"5. After the review_proposal tool is called if any sections are approved, use the section_writer tool to write ONLY the sections of the report based on the **Approved Outline**{':' + str([outline[section]['title'] for section in outline]) if outline else ''} generated from the review_proposal tool. Ensure the report is well-written, properly sourced, and easy to understand. Avoid responding with the text of the report directly, always use the section_writer tool for the final product.\n\n"
            "After using the section_writer tool, actively engage with the user to discuss next steps. **Do not summarize your completed work**, as the user has full access to the research progress.\n"
            "Instead of sharing details like generated outlines or reports, simply confirm the task is ready and ask for feedback or next steps. For example:\n"
            "'I have completed [..MAX additional 5 words]. Would you like me to [..MAX additional 5 words]?'\n\n"
            "When you have a proposal, you must only write the sections that are approved. If a section is not approved, you must not write it."
            "Your role is to provide support, maintain clear communication, and ensure the final report aligns with the user's expectations.\n\n"
        ]

        # If the proposal has remarks and no outline, we add the proposal to the prompt
        if proposal.get('remarks') and not outline:
            prompt_parts.append(
                f"**\nReviewed Proposal:**\n"
                f"Approved: {proposal['approved']}\n"
                f"Sections: {proposal['sections']}\n"
                f"User's feedback: {proposal['remarks']}"
                "You must use the outline_writer tool to create a new outline proposal that incorporates the user's feedback\n."
            )

        # If the outline is present, we add it to the prompt
        if outline:
            prompt_parts.append(
                f"### Current State of the Report\n"
                f"\n**Approved Outline**:\n{outline}\n\n"
            )

        # If the sections are present, we add them to the prompt
        if sections:
            report_content = "\n".join(
                f"section {section['idx']} : {section['title']}\n"
                f"content : {section['content']}"
                f"footer : {section['footer']}\n"
                for section in sections
            )
            prompt_parts.append(f"**Report**:\n\n{report_content}")

        return "\n".join(prompt_parts)

    async def call_model_node(self, state: ResearchState, config: RunnableConfig) -> Command[Literal["tool_node", "__end__"]]:
        """
        Node for calling the model and handling the system prompt, messages, state, and tool bindings.
        """
        # Ensure last message is of correct type
        last_message = state['messages'][-1]
        if not isinstance(last_message, (AIMessage, SystemMessage, HumanMessage, ToolMessage)):
            last_message = HumanMessage(content=last_message.content)
            state['messages'][-1] = last_message
        
        # Call LLM
        model = cfg.FACTUAL_LLM.bind_tools(self.tools, parallel_tool_calls=False)
        response = await model.ainvoke([
            SystemMessage(content=self._build_system_prompt(state)),
            *state["messages"],
        ], config)


        response = cast(AIMessage, response)

        # If the LLM decided to use a tool, we go to the tool node. Otherwise, we end the graph.
        if response.tool_calls:
            return Command(goto="tool_node", update={"messages": response})
        return Command(goto="__end__", update={"messages": response})

    async def tool_node(self, state: ResearchState, config: RunnableConfig) -> Command[Literal["process_feedback_node", "call_model_node"]]:
        """
        Custom asynchronous tool node that can access and update agent state. This is necessary
        because tools cannot access or update state directly.
        """
        config = copilotkit_customize_config(config, emit_messages=False) # Disable emitting messages to the frontend since these messages will be intermediate

        msgs = []
        tool_state = {}
        for tool_call in state["messages"][-1].tool_calls:
            if tool_call["name"] == "review_proposal":
                return Command(goto="process_feedback_node", update={"messages": ToolMessage(tool_call_id=tool_call["id"], content="")})

            # Temporary messages struct that are accessible only to tools.
            state['messages'] = {'HumanMessage' if type(message) == HumanMessage else 'AIMessage' : message.content for message in state['messages']}

            # Add a state key to the tool call so the tool can access state
            tool_call["args"]["state"] = state
            
            # Manually invoke the tool that the LLM decided to use with the args it provided.
            # Keep in mind, the state key we added above will be apart of args.
            tool = self.tools_by_name[tool_call["name"]]
            new_state, tool_msg = await tool.ainvoke(tool_call["args"]) # new_state will be the result of the tool call

            # Remove the state key since we don't need to commit it into the saved state
            tool_call["args"]["state"] = None
            msgs.append(ToolMessage(content=tool_msg, name=tool_call["name"], tool_call_id=tool_call["id"]))

            # Build the tool state so we can emit it and commit it into the saved state
            tool_state = {
                "title": new_state.get("title", ""),
                "outline": new_state.get("outline", {}),
                "sections": new_state.get("sections", []),
                "sources": new_state.get("sources", {}),
                "proposal": new_state.get("proposal", {}),
                "logs": new_state.get("logs", []),
                "tool": new_state.get("tool", {}),
                "messages": msgs
            }
            await copilotkit_emit_state(config, tool_state)

        return tool_state

    @staticmethod
    async def process_feedback_node(state: ResearchState, config: RunnableConfig):
        """
        Node for retrieving and processing feedback from the user via the frontend.
        """

        # Interrupt the graph and wait for feedback. CopilotKit will render a form and wait for the user to submit it on
        # the frontend.
        reviewed_outline = interrupt(state.get("proposal", {}))

        # Process the feedback we have in reviewed_proposal.
        if reviewed_outline.get("approved"):
            outline = {k: {'title': v['title'], 'description': v['description']} for k, v in
                        reviewed_outline.get("sections", {}).items()
                        if isinstance(v, dict) and v.get('approved')}
            state['outline'] = outline

        # Update proposal and commit the state. Add a system message so the LLM knows that this interaction took place.
        state["proposal"] = reviewed_outline
        state["messages"] = [SystemMessage(content="User has reviewed the proposal, please process their feedback and act accordingly.")]
        return Command(goto="call_model_node", update={**state})

graph = ResearchAgent().graph
